import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const declaration = name => {
  const line = source.split('\n').find(line => line.startsWith(`function ${name}(`) || line.startsWith(`async function ${name}(`));
  assert.ok(line, `Production function ${name} exists`);
  return line;
};

test('IndexedDB backup pins the account key before opening the database', async () => {
  let resolveDb;
  const opened = new Promise(resolve => { resolveDb = resolve; });
  const written = [];
  const tx = { objectStore: () => ({ put(value, key) { written.push({ value, key }); queueMicrotask(() => tx.oncomplete()); } }) };
  const context = vm.createContext({ storageKey: 'account-a', STORAGE_STORE: 'state', openStorageDb: () => opened });
  vm.runInContext(declaration('writeStorageBackup'), context);
  const pending = vm.runInContext('writeStorageBackup({ owner: "a" })', context);
  context.storageKey = 'account-b';
  resolveDb({ transaction: () => tx, close() {} });
  await pending;
  assert.equal(written[0].key, 'account-a');
});

test('backup recovery does not apply the previous account data after switching', async () => {
  let resolveBackup;
  const pendingBackup = new Promise(resolve => { resolveBackup = resolve; });
  const context = vm.createContext({ storageKey: 'account-a', state: { _savedAt: 1 }, readStorageBackup: () => pendingBackup, migrate: x => x, window: { SeverSecurityCore: { persistentState: x => x } }, localStorage: { setItem() {} }, toast() {} });
  vm.runInContext(declaration('recoverLatestState'), context);
  const pending = vm.runInContext('recoverLatestState()', context);
  context.storageKey = 'account-b';
  context.state = { owner: 'b', _savedAt: 2 };
  resolveBackup({ owner: 'a', _savedAt: 3 });
  await pending;
  assert.equal(context.state.owner, 'b');
});

test('cloud capture failure still allows local save', async () => {
  let persisted = false;
  const context = vm.createContext({ window: { SeverApp: { beforeLocalSave() { throw new Error('queue unavailable'); } } }, persistLocal: async () => { persisted = true; } });
  vm.runInContext(declaration('save'), context);
  await vm.runInContext('save()', context);
  assert.equal(persisted, true);
});

test('extra timer tick after completion does not count another session', () => {
  const context = vm.createContext({ uid: () => "session-1", timerMinutes: 1, focusStartedAt: 1, render() {}, timerRunning: true, timerTrackedAt: 1, timerLeft: 0, timerEnd: 1, timerInterval: 7, activeTaskId: '', state: { tasks: [], stats: { sessions: 0 } }, trackFocusElapsed() {}, renderTimer() {}, saveTimerState() {}, clearInterval() {}, save() {}, renderProgress() {}, toast() {}, notificationSupport: () => false });
  vm.runInContext(declaration('timerTick'), context);
  vm.runInContext('timerTick(); timerTick();', context);
  assert.equal(context.state.stats.sessions, 1);
});
