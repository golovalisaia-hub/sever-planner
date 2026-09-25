// Undo: at least 10 minutes, never destroys a newer change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, applyOps, createTask } from '../fakes/fixtures.mjs';
import { asOwnerRaw } from '../fakes/db.mjs';

test('undo reverts an update exactly, including derived fields', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const task = await createTask(repos, ctx, { title: 'Позвонить', plan_date: '2026-09-26', plan_precision: 'day' });
  const { action } = await applyOps(repos, ctx, [{ op: 'update', entity: 'task', id: task.id, expected_version: 1, patch: { plan_date: '2026-09-27', status: 'done' } }]);
  const moved = await repos.tasks.get(ctx, task.id);
  assert.equal(moved.reschedule_count, 1);
  assert.ok(moved.completed_at);

  const result = await repos.actions.undo(ctx, action.id);
  assert.equal(result.status, 'undone');
  const back = await repos.tasks.get(ctx, task.id);
  assert.equal(back.plan_date, '2026-09-26');
  assert.equal(back.status, 'open');
  assert.equal(back.completed_at, null);
  assert.equal(back.reschedule_count, 0, 'an undone move is not counted as a reschedule');
  assert.equal(back.version, 3, 'undo is a new version, not a rewind of history');
  const history = await repos.activity.forEntity(ctx, 'task', task.id);
  assert.deepEqual(history.map(h => h.action), ['undo', 'update', 'create']);
  assert.equal(history[0].undo_of, history[1].id);
});

test('undo of a capture removes the created records (soft) and can be replayed safely', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const { action, result } = await applyOps(repos, ctx, [
    { op: 'create', entity: 'task', data: { title: 'A' } },
    { op: 'create', entity: 'note', data: { body: 'B' } },
  ]);
  await repos.actions.undo(ctx, action.id);
  assert.equal(await repos.tasks.get(ctx, result.operations[0].id), null);
  assert.equal(await repos.notes.get(ctx, result.operations[1].id), null);
  const replay = await repos.actions.undo(ctx, action.id);
  assert.equal(replay.replayed, true);
});

test('undo conflict: a newer change is never silently destroyed', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const a = await createTask(repos, ctx, { title: 'A', plan_date: '2026-09-26', plan_precision: 'day' });
  const b = await createTask(repos, ctx, { title: 'B', plan_date: '2026-09-26', plan_precision: 'day' });
  const bulk = await applyOps(repos, ctx, [
    { op: 'update', entity: 'task', id: a.id, expected_version: 1, patch: { plan_date: '2026-09-27' } },
    { op: 'update', entity: 'task', id: b.id, expected_version: 1, patch: { plan_date: '2026-09-27' } },
  ]);
  // The user edits B afterwards.
  await applyOps(repos, ctx, [{ op: 'update', entity: 'task', id: b.id, expected_version: 2, patch: { title: 'B (новое название)' } }]);

  await assert.rejects(repos.actions.undo(ctx, bulk.action.id), { code: 'UNDO_CONFLICT' });
  // All-or-nothing: A was not reverted either, B keeps the newer change.
  assert.equal((await repos.tasks.get(ctx, a.id)).plan_date, '2026-09-27');
  const bNow = await repos.tasks.get(ctx, b.id);
  assert.equal(bNow.title, 'B (новое название)');
  assert.equal(bNow.plan_date, '2026-09-27');
  assert.equal((await repos.actions.get(ctx, bulk.action.id)).status, 'applied');
});

test('undo after the window has passed is refused', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const { action, result } = await applyOps(repos, ctx, [{ op: 'create', entity: 'task', data: { title: 'A' } }]);
  const stored = await repos.actions.get(ctx, action.id);
  const windowMs = new Date(stored.undo_until) - new Date(stored.applied_at);
  assert.ok(windowMs >= 10 * 60 * 1000, 'default undo window is at least 10 minutes');
  await asOwnerRaw(pg, `update izi.pending_actions set undo_until = now() - interval '1 second' where id = $1`, [action.id]);
  await assert.rejects(repos.actions.undo(ctx, action.id), { code: 'UNDO_EXPIRED' });
  assert.ok(await repos.tasks.get(ctx, result.operations[0].id));
  await assert.rejects(repos.actions.propose(ctx, { kind: 'mutation', channel: 'telegram', operations: [{ op: 'create', entity: 'note', data: { body: 'x' } }], undoWindowMinutes: 5 }), { code: 'VALIDATION' });
});

test('undo of a conversion restores the inbox item and removes the created task', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const inboxId = (await applyOps(repos, ctx, [{ op: 'create', entity: 'inbox_item', data: { text: 'изучить Playwright' } }])).result.operations[0].id;
  const conversion = await applyOps(repos, ctx, [{ op: 'convert', entity: 'inbox_item', id: inboxId, expected_version: 1, into: { entity: 'task', data: { title: 'Изучить Playwright' } } }], { kind: 'conversion' });
  await repos.actions.undo(ctx, conversion.action.id);
  const item = await repos.inbox.get(ctx, inboxId);
  assert.equal(item.status, 'unprocessed');
  assert.equal(item.converted_task_id, null);
  assert.equal(await repos.tasks.get(ctx, conversion.result.operations[0].created.id), null);
});

test('undo of a delete restores the record', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const task = await createTask(repos, ctx, { title: 'Не удалять' });
  const { action } = await applyOps(repos, ctx, [{ op: 'delete', entity: 'task', id: task.id, expected_version: 1 }]);
  assert.equal(await repos.tasks.get(ctx, task.id), null);
  await repos.actions.undo(ctx, action.id);
  assert.equal((await repos.tasks.get(ctx, task.id)).title, 'Не удалять');
});

test('only applied actions can be undone', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const pending = await repos.actions.propose(ctx, { kind: 'mutation', channel: 'telegram', operations: [{ op: 'create', entity: 'note', data: { body: 'x' } }] });
  await assert.rejects(repos.actions.undo(ctx, pending.id), { code: 'INVALID_STATE' });
});
