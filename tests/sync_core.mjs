import assert from 'node:assert/strict';
import { collectionsFor, diffCollections, mergeStates, prepareState, queueLatest, rowsToState } from '../js/sync-core.mjs';

const base = () => ({ version: 9, tasks: [], habits: [], checks: {}, notes: [], folders: [], focusSessions: [], taskMemory: [], stats: { focusMs: 0, sessions: 0 }, reminders: {}, profile: {} });
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('projects planner data to stable cloud collections', () => {
  const state = base();
  state.tasks.push({ id: 'task-1', title: 'Python', date: '2026-09-04', duration: 30, category: 'Учёба', completed: false });
  state.habits.push({ id: 'habit-1', title: 'Читать' }); state.checks['habit-1'] = ['2026-09-04'];
  const data = collectionsFor(state);
  assert.equal(data.tasks.get('task-1').title, 'Python');
  assert.equal(data.habitEntries.get('habit-1:2026-09-04').completed, true);
});

test('protected note projects only ciphertext', () => {
  const state = base();
  state.notes.push({ id: 'private-1', title: '', body: '', items: [], kind: 'protected', protected: true, secure: { salt: 'a', iv: 'b', cipher: 'secret-cipher' } });
  const row = collectionsFor(state).notes.get('private-1');
  assert.equal(row.title, ''); assert.equal(row.body, ''); assert.deepEqual(row.items, []); assert.equal(row.secure.cipher, 'secret-cipher');
  assert.doesNotMatch(JSON.stringify(row), /unencrypted|password/i);
});

test('queues only the newest operation per record', () => {
  const queued = queueLatest([
    { collection: 'tasks', id: 'one', record: { updatedAt: '2026-09-04T09:00:00.000Z' } },
    { collection: 'tasks', id: 'one', record: { updatedAt: '2026-09-04T10:00:00.000Z', completed: true } }
  ]);
  assert.equal(queued.length, 1); assert.equal(queued[0].record.completed, true);
});

test('deletion creates a tombstone operation', () => {
  const before = base(); before.tasks.push({ id: 'gone', title: 'Удалить', updatedAt: 1 });
  const after = base();
  const changes = diffCollections(collectionsFor(before), collectionsFor(after), Date.UTC(2026, 8, 4));
  assert.equal(changes.length, 1); assert.equal(changes[0].type, 'delete'); assert.ok(changes[0].record.deletedAt);
});

test('last write wins during merge without duplicate tasks', () => {
  const local = base(); local.tasks.push({ id: 'same', title: 'Старое', completed: false, updatedAt: 10 });
  const remote = base(); remote.tasks.push({ id: 'same', title: 'Новое', completed: true, updatedAt: 20 });
  const merged = mergeStates(local, remote);
  assert.equal(merged.tasks.length, 1); assert.equal(merged.tasks[0].title, 'Новое'); assert.equal(merged.tasks[0].completed, true);
});

test('tombstone wins over an older remote record', () => {
  const local = base(); local.syncMeta = { tombstones: { 'tasks:same': { collection: 'tasks', id: 'same', title: 'Удалено', deletedAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z' } } };
  const remote = base(); remote.tasks.push({ id: 'same', title: 'Старая задача', updatedAt: '2026-09-04T09:00:00.000Z' });
  const merged = mergeStates(local, remote);
  assert.equal(merged.tasks.length, 0); assert.ok(merged.syncMeta.tombstones['tasks:same']);
});
test('cloud rows restore completed task and encrypted note safely', () => {
  const restored = rowsToState(base(), { tasks: [{ id: 't', title: 'ПДД', scheduled_for: '2026-09-04', duration_minutes: 30, category: 'Учёба', priority: false, challenge: false, completed: true, completed_at: '2026-09-04T08:00:00Z', created_at: '2026-09-04T07:00:00Z', updated_at: '2026-09-04T08:00:00Z', deleted_at: null }], notes: [{ id: 'n', folder_id: null, title: '', body: '', kind: 'protected', items: [], done: false, protected: true, secure: { cipher: 'x' }, created_at: '2026-09-04T07:00:00Z', updated_at: '2026-09-04T08:00:00Z', deleted_at: null }] });
  assert.equal(restored.tasks[0].completed, true); assert.equal(restored.notes[0].protected, true); assert.equal(restored.notes[0].title, '');
});

test('prepareState timestamps changed records but leaves current focus history primary', () => {
  const state = base(); state.focusSessions.push({ id: 'focus', durationMinutes: 25, status: 'completed' });
  const prepared = prepareState(state, null, Date.UTC(2026, 8, 4));
  assert.ok(prepared.focusSessions.get('focus').updatedAt); assert.equal(state.focusSessions.length, 1);
});

let passed = 0;
for (const { name, fn } of tests) { try { fn(); passed += 1; console.log(`PASS  ${name}`); } catch (error) { console.error(`FAIL  ${name}`); console.error(error.stack); process.exitCode = 1; } }
console.log(`\n${passed}/${tests.length} checks passed`);
