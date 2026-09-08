import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../js/sync-core.mjs';

const source = fs.readFileSync(new URL('../js/cloud-runtime.js', import.meta.url), 'utf8');
const runtime = source.slice(source.indexOf('\n') + 1, source.indexOf('\nfunction counts('));
const at = Date.parse('2026-09-07T08:00:00Z');
const clone = value => JSON.parse(JSON.stringify(value));
const fresh = () => ({ tasks: [], notes: [], folders: [], habits: [], checks: {}, focusSessions: [], stats: {}, syncMeta: { seededAt: at, settingsUpdatedAt: at, tombstones: {}, habitEntryUpdatedAt: {} } });
const task = (id, title = id) => ({ id, title, date: '2026-09-07', duration: 25, category: 'Личное', priority: false, challenge: false, completed: false, completedAt: null, createdAt: at, updatedAt: at });
const operation = record => ({ collection: 'tasks', id: record.id, type: 'upsert', record: { ...record, updatedAt: new Date(record.updatedAt).toISOString() } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness() {
  let state = fresh();
  const storage = new Map(), timers = new Map(), channels = [], broadcasts = [];
  let timerId = 0;
  const setTimer = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; };
  const clearTimer = id => timers.delete(id);
  class Broadcast {
    constructor() { this.closed = false; broadcasts.push(this); }
    addEventListener() {}
    postMessage() {}
    close() { this.closed = true; }
  }
  const client = {
    channel() {
      const channel = {
        on() { return this; },
        subscribe(callback) { this.callback = callback; return this; },
        unsubscribe() { this.closed = true; this.callback?.('CLOSED'); return Promise.resolve(); }
      };
      channels.push(channel);
      return channel;
    },
    from() { return { upsert: async () => ({ error: null }) }; }
  };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  };
  const app = {
    getState: () => state,
    freshState: fresh,
    getLegacyStateFor: fresh,
    replaceState: async next => { state = next; },
    persist: async () => {},
    render() {},
    setCloudStatus() {},
    lockProtectedNotes() {},
    getAnonymousImportCandidate: fresh,
    switchStorageScope: (_id, next) => { state = next; }
  };
  const window = { setTimeout: setTimer, clearTimeout: clearTimer, setInterval: setTimer, addEventListener() {}, dispatchEvent() {}, BroadcastChannel: Broadcast, SeverSupabase: { getClient: async () => client, configured: () => true }, SeverSecurityCore: { assertCloudOperation() {} } };
  const context = vm.createContext({ ...core, window, document: { addEventListener() {}, visibilityState: 'visible' }, localStorage, navigator: { onLine: true }, BroadcastChannel: Broadcast, setTimeout: setTimer, clearTimeout: clearTimer, queueMicrotask, CustomEvent: class {}, Event: class {}, URL, app });
  const cloud = vm.runInContext(`${runtime}\nnew SeverCloud(app)`, context);
  cloud.user = { id: 'user-a' };
  cloud.hydrated = true;
  cloud.baseline = core.collectionsFor(state);
  return { cloud, client, app, storage, timers, channels, broadcasts, localStorage, window, get state() { return state; }, set state(value) { state = value; }, async runTimer(id) { const timer = timers.get(id); assert.ok(timer, 'retry must be scheduled'); timers.delete(id); await timer.fn(); await turn(); } };
}

test('closing cloud resources closes both Realtime and BroadcastChannel', async () => {
  const h = harness();
  h.cloud.initialSync = async () => {};
  h.cloud.hydrated = false;
  await h.cloud.handleSession({ id: 'user-a' });
  h.cloud.subscribe();
  await turn();
  h.cloud.clearRealtime();
  assert.equal(h.broadcasts[0].closed, true);
  assert.equal(h.channels[0].closed, true);
  assert.equal(h.timers.size, 0, 'intentional close must not schedule reconnection');
});

test('Realtime reconnects after a channel failure', async () => {
  const h = harness();
  h.cloud.subscribe();
  await turn();
  h.channels[0].callback('CHANNEL_ERROR');
  await h.runTimer(h.cloud.realtimeReconnectTimer);
  assert.equal(h.channels.length, 2);
});

test('first download is retried after transient failure before hydration', async () => {
  const h = harness();
  h.cloud.hydrated = false;
  h.cloud.fetchAll = async () => { throw new Error('network unavailable'); };
  await h.cloud.initialSync();
  let restored = false;
  h.cloud.restoreSession = async () => { restored = true; };
  await h.runTimer(h.cloud.timer);
  assert.equal(restored, true);
});

test('edits added during an upload are drained without another user action', async () => {
  const h = harness(), gate = deferred();
  h.storage.set(h.cloud.queueKey, JSON.stringify([operation(task('first'))]));
  h.client.from = () => ({ upsert: async () => { await gate.promise; return { error: null }; } });
  const upload = h.cloud.flush();
  await turn();
  h.cloud.queue([operation(task('second'))]);
  await h.runTimer(h.cloud.timer); // Debounce fires while the first request is still in flight.
  gate.resolve();
  await upload;
  assert.equal(h.cloud.status, 'pending');
  await h.runTimer(h.cloud.timer);
  assert.equal(h.cloud.queued.length, 0);
});

test('in-flight upload cannot send old-account records as the new account', async () => {
  const h = harness(), gate = deferred(), sent = [];
  const oldKey = h.cloud.queueKey;
  h.storage.set(oldKey, JSON.stringify([operation(task('first')), operation(task('second'))]));
  h.client.from = () => ({ upsert: async row => { sent.push(row); if (sent.length === 1) await gate.promise; return { error: null }; } });
  const upload = h.cloud.flush();
  await turn();
  h.cloud.user = { id: 'user-b' };
  h.storage.set(h.cloud.queueKey, JSON.stringify([operation(task('new-account'))]));
  gate.resolve();
  await upload;
  assert.equal(sent.length, 1, 'old upload must stop at an account change');
  assert.ok(sent.every(row => row.user_id === 'user-a'));
  assert.equal(JSON.parse(h.storage.get(oldKey)).length, 2);
  assert.equal(h.cloud.queued[0].id, 'new-account');
});

test('download merges with state saved while the request was in flight', async () => {
  const h = harness(), gate = deferred();
  h.cloud.fetchAll = () => gate.promise;
  const pull = h.cloud.pull();
  await turn();
  h.state = { ...clone(h.state), tasks: [task('new-local')] };
  gate.resolve({});
  await pull;
  assert.equal(h.state.tasks[0]?.id, 'new-local');
});

test('late initial download cannot replace a signed-out planner', async () => {
  const h = harness(), gate = deferred();
  h.cloud.fetchAll = () => gate.promise;
  const first = h.cloud.initialSync();
  await turn();
  await h.cloud.handleSession(null);
  h.state.tasks.push(task('anonymous'));
  gate.resolve({ tasks: [{ id: 'private', title: 'Private', updated_at: new Date(at).toISOString() }] });
  await first;
  assert.deepEqual(h.state.tasks.map(row => row.id), ['anonymous']);
  assert.equal(h.cloud.hydrated, false);
});

test('cloud loading reads all pages beyond the server row limit', async () => {
  const h = harness(), all = Array.from({ length: 1205 }, (_, id) => ({ id }));
  h.client.from = table => {
    const rows = table === 'tasks' ? all : [];
    const query = {
      select() { return this; }, eq() { return this; }, order() { return this; },
      range(from, to) { return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); },
      then(resolve) { return Promise.resolve({ data: rows.slice(0, 1000), error: null }).then(resolve); }
    };
    return query;
  };
  const rows = await h.cloud.fetchAll();
  assert.equal(rows.tasks.length, all.length);
});

test('unchanged ordinary notes do not receive a new timestamp on every save', () => {
  const state = fresh();
  state.notes = [{ id: 'note', title: 'Draft', body: '', kind: 'text', items: [], protected: false, done: false, folderId: '', createdAt: at, updatedAt: at }];
  const before = core.collectionsFor(state);
  const after = core.prepareState(state, before, at + 10000);
  assert.equal(state.notes[0].updatedAt, at);
  assert.equal(core.diffCollections(before, after).length, 0);
});

test('restored focus timestamps work with the dashboard local-day calculation', () => {
  const state = core.rowsToState(fresh(), { focusSessions: [{ id: 'focus', duration_minutes: 25, status: 'completed', started_at: '2026-09-07T08:00:00Z', completed_at: '2026-09-07T08:25:00Z', updated_at: '2026-09-07T08:25:00Z' }] });
  assert.equal(state.focusSessions[0].completedAt, Date.parse('2026-09-07T08:25:00Z'));
  assert.equal(state.focusSessions[0].startedAt, at);
});

test('in-place checklist and settings edits remain detectable in cloud snapshots', () => {
  const state = fresh();
  state.profile = { name: 'Before' };
  state.notes = [{ id: 'list', title: 'List', body: '', kind: 'checklist', items: [{ id: 'item', text: 'Read', done: false }], protected: false, updatedAt: at }];
  const before = core.collectionsFor(state);
  state.notes[0].items[0].done = true;
  state.profile.name = 'After';
  const after = core.prepareState(state, before, at + 1000);
  assert.equal(before.notes.get('list').items[0].done, false);
  assert.equal(before.settings.get('settings').data.profile.name, 'Before');
  assert.equal(after.notes.get('list').updatedAt, new Date(at + 1000).toISOString());
  assert.ok(core.diffCollections(before, after).some(op => op.collection === 'notes'));
  assert.ok(core.diffCollections(before, after).some(op => op.collection === 'settings'));
});

test('queue storage failure does not discard the baseline needed to retry', () => {
  const h = harness();
  h.state.tasks.push(task('recoverable'));
  h.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.doesNotThrow(() => h.cloud.capture());
  assert.equal(h.cloud.baseline.tasks.has('recoverable'), false);
  h.localStorage.setItem = (key, value) => h.storage.set(key, value);
  h.cloud.capture();
  assert.ok(h.cloud.queued.some(op => op.id === 'recoverable'));
});

test('another edit in the same millisecond survives an earlier upload acknowledgement', async () => {
  const h = harness(), gate = deferred();
  h.storage.set(h.cloud.queueKey, JSON.stringify([operation(task('same', 'Before'))]));
  h.client.from = () => ({ upsert: async () => { await gate.promise; return { error: null }; } });
  const upload = h.cloud.flush();
  await turn();
  h.cloud.queue([operation(task('same', 'After'))]);
  gate.resolve();
  await upload;
  assert.equal(h.cloud.queued.length, 1);
  assert.equal(h.cloud.queued[0].record.title, 'After');
});

test('requesting sign-out invalidates an initial download before it can apply', async () => {
  const h = harness(), gate = deferred();
  h.cloud.hydrated = false;
  h.cloud.fetchAll = () => gate.promise;
  const applied = [];
  const replace = h.app.replaceState;
  h.app.replaceState = async next => { applied.push(next); await replace(next); };
  const signingIn = h.cloud.applySession({ id: 'user-a' });
  await turn();
  const signingOut = h.cloud.applySession(null);
  gate.resolve({ tasks: [{ id: 'private', title: 'Private', updated_at: new Date(at).toISOString() }] });
  await Promise.all([signingIn, signingOut]);
  assert.equal(applied.length, 0);
  assert.equal(h.cloud.user, null);
});

test('pulls coalesce without overlapping network downloads', async () => {
  const h = harness(), first = deferred();
  let calls = 0, active = 0, maxActive = 0;
  h.cloud.fetchAll = async () => {
    calls++; active++; maxActive = Math.max(maxActive, active);
    if (calls === 1) await first.promise;
    active--; return {};
  };
  const initial = h.cloud.pull();
  h.cloud.pull(); h.cloud.pull();
  first.resolve();
  await initial;
  await turn();
  assert.equal(maxActive, 1);
  assert.equal(calls, 2);
});

test('anonymous planner changes never create a cloud queue or write to Supabase', async () => {
  const h = harness();
  let writes = 0;
  h.client.from = () => ({ upsert: async () => { writes += 1; return { error: null }; } });
  h.cloud.user = null;
  h.cloud.hydrated = false;
  h.state.tasks.push(task('anonymous-only'));
  h.cloud.capture();
  await h.cloud.flush();
  assert.equal(h.storage.has('sever-cloud-queue-v2:user-a'), false);
  assert.equal(writes, 0);
  assert.equal(h.channels.length, 0);

});
test('ACTIVE_USER_KEY without an Auth session never opens account storage', async () => {
  const h = harness();
  const accountState = { ...fresh(), tasks: [task('account-a')] };
  h.storage.set('sever-cloud-active-user-v1', JSON.stringify({ id: 'user-a' }));
  h.storage.set('sever-cloud-state-v1:user-a', JSON.stringify(accountState));
  h.cloud.user = null;
  h.cloud.hydrated = false;
  let openedAccountScope = false;
  h.app.switchStorageScope = (userId, next) => {
    openedAccountScope ||= Boolean(userId);
    h.state = next;
  };
  h.window.SeverSupabase.ready = async () => { throw new Error('network unavailable'); };
  await h.cloud.start();
  assert.equal(openedAccountScope, false);
  assert.equal(h.cloud.user, null);
  assert.deepEqual(h.state.tasks, []);

});
test('account download stays visible until an anonymous import is explicitly accepted', async () => {
  const h = harness();
  const anonymous = { ...fresh(), tasks: [task('anonymous-task')] };
  h.app.getAnonymousImportCandidate = () => anonymous;
  h.cloud.fetchAll = async () => ({ tasks: [{ id: 'cloud-task', title: 'Cloud task', scheduled_for: '2026-09-07', duration_minutes: 25, category: 'Личное', priority: false, challenge: false, completed: false, completed_at: null, created_at: new Date(at).toISOString(), updated_at: new Date(at).toISOString(), deleted_at: null }] });
  h.window.SeverCloudUI = { showMigration: (_candidate, options) => { h.migration = options; } };
  await h.cloud.initialSync();
  assert.deepEqual(h.state.tasks.map(row => row.id), ['cloud-task']);
  assert.equal(h.migration?.anonymous, true);
  assert.equal(h.cloud.queued.length, 0);
});

test('keeping anonymous data separate never uploads it', async () => {
  const h = harness();
  const anonymous = { ...fresh(), tasks: [task('anonymous-task')] };
  h.app.getAnonymousImportCandidate = () => anonymous;
  h.state = { ...fresh(), tasks: [task('cloud-task')] };

  h.cloud.baseline = core.collectionsFor(h.state);
  h.cloud.keepLocalOnly({ anonymous: true });
  assert.equal(h.storage.has('sever-cloud-queue-v2:user-a'), false);
  assert.equal(JSON.parse(h.storage.get(h.cloud.markerKey)).anonymousImportHandled, true);
});
test('anonymous data enters the account queue only after explicit import confirmation', async () => {
  const h = harness();
  const anonymous = { ...fresh(), tasks: [task('anonymous-task')] };
  h.app.getAnonymousImportCandidate = () => anonymous;
  h.state = fresh();
  h.cloud.baseline = core.collectionsFor(h.state);
  h.cloud.flush = async () => {};
  await h.cloud.acceptMigration({ anonymous: true });
  assert.ok(h.state.tasks.some(row => row.id === 'anonymous-task'));
  assert.ok(h.cloud.queued.some(operation => operation.id === 'anonymous-task'));
});
