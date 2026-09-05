import assert from 'node:assert/strict';
import { collectionsFor, diffCollections, mergeStates, prepareState, queueLatest, rowsToState, settleCloudOperations, sortCloudOperations } from '../js/sync-core.mjs';

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
  assert.deepEqual(data.settings.get('settings').data.stats, { focusMs: 0, sessions: 0 });
});

test('restores every synced planner section on a second device', () => {
  const restored = rowsToState(base(), {
    tasks: [{ id: 'task', title: 'Задача', scheduled_for: '2026-09-06', duration_minutes: 20, category: 'Личное', priority: true, challenge: false, completed: false, created_at: '2026-09-05T08:00:00Z', updated_at: '2026-09-05T08:00:00Z' }],
    habits: [{ id: 'habit', title: 'Читать', created_at: '2026-09-05T08:00:00Z', updated_at: '2026-09-05T08:00:00Z' }],
    habitEntries: [{ habit_id: 'habit', entry_date: '2026-09-05', completed: true, updated_at: '2026-09-05T09:00:00Z' }],
    folders: [{ id: 'folder', name: 'Работа', created_at: '2026-09-05T08:00:00Z', updated_at: '2026-09-05T08:00:00Z' }],
    notes: [{ id: 'note', folder_id: 'folder', title: 'Идея', body: 'Текст', kind: 'text', items: [], done: false, protected: false, secure: null, created_at: '2026-09-05T08:00:00Z', updated_at: '2026-09-05T08:00:00Z' }],
    focusSessions: [{ id: 'focus', task_id: 'task', duration_minutes: 20, started_at: '2026-09-05T08:00:00Z', completed_at: '2026-09-05T08:20:00Z', status: 'completed', created_at: '2026-09-05T08:00:00Z', updated_at: '2026-09-05T08:20:00Z' }],
    settings: [{ data: { challengeName: 'Курс', stats: { focusMs: 1200000, sessions: 1 }, profile: { name: 'Пользователь' } }, updated_at: '2026-09-05T08:20:00Z' }]
  });
  assert.equal(restored.tasks[0].title, 'Задача');
  assert.equal(restored.notes[0].folderId, 'folder');
  assert.equal(restored.folders[0].name, 'Работа');
  assert.deepEqual(restored.checks.habit, ['2026-09-05']);
  assert.equal(restored.focusSessions[0].durationMinutes, 20);
  assert.equal(restored.stats.focusMs, 1200000);
  assert.equal(restored.profile.name, 'Пользователь');
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

test('uploads parent records before dependent notes and entries', () => {
  const operations = [
    { collection: 'notes', id: 'note' },
    { collection: 'habitEntries', id: 'entry' },
    { collection: 'folders', id: 'folder' },
    { collection: 'habits', id: 'habit' }
  ];
  assert.deepEqual(sortCloudOperations(operations).map(operation => operation.collection), ['habits', 'habitEntries', 'folders', 'notes']);
});

test('one rejected cloud row does not block unrelated data', async () => {
  const attempted = [];
  const operations = [{ collection: 'notes', id: 'bad' }, { collection: 'tasks', id: 'task' }, { collection: 'settings', id: 'settings' }];
  const result = await settleCloudOperations(operations, async operation => {
    attempted.push(operation.id);
    if (operation.id === 'bad') throw new Error('rejected row');
  });
  assert.deepEqual(attempted, ['task', 'bad', 'settings']);
  assert.deepEqual(result.succeeded.map(operation => operation.id), ['task', 'settings']);
  assert.deepEqual(result.failed.map(item => item.operation.id), ['bad']);
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
for (const { name, fn } of tests) { try { await fn(); passed += 1; console.log(`PASS  ${name}`); } catch (error) { console.error(`FAIL  ${name}`); console.error(error.stack); process.exitCode = 1; } }
console.log(`\n${passed}/${tests.length} checks passed`);
