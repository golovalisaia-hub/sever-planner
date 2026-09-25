// Preview -> Confirm -> Apply: one transaction, all or nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, applyOps, createTask } from '../fakes/fixtures.mjs';
import { asOwnerRaw } from '../fakes/db.mjs';

const count = async (pg, table, accountId) => (await pg.query(`select count(*)::int n from izi.${table} where account_id = $1`, [accountId])).rows[0].n;

/** The reference phrase from the product brief, as the capture layer will one day propose it. */
const REFERENCE = [
  { op: 'create', entity: 'event', data: { title: 'Стоматолог', start_date: '2026-09-26', start_time: '16:00' } },
  { op: 'create', entity: 'task', data: { title: 'Купить пасту', plan_date: '2026-09-26', plan_precision: 'day' } },
  { op: 'create', entity: 'task', data: { title: 'Английский', plan_date: '2026-09-25', plan_precision: 'day', part_of_day: 'evening', duration_minutes: 30 } },
  { op: 'create', entity: 'task', data: { title: 'Оплатить интернет', due_date: '2026-10-02' } },
];

async function captureInPreview(repos, ctx, text) {
  const capture = await repos.captures.create(ctx, { source: 'telegram_text', externalRef: `chat:${Math.random().toString(36).slice(2, 10)}`, rawText: text });
  await repos.captures.transition(ctx, capture.id, 'pending', 'processing');
  await repos.captures.transition(ctx, capture.id, 'processing', 'preview');
  return capture;
}

test('confirming a capture applies every item and links provenance', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const capture = await captureInPreview(repos, ctx, 'Завтра стоматолог в 16:00, после него купить пасту…');
  const action = await repos.actions.propose(ctx, { kind: 'capture', channel: 'telegram', captureId: capture.id, operations: REFERENCE });
  assert.equal(action.status, 'pending');
  assert.match(action.shortToken, /^[0-9a-f]{32}$/);
  assert.equal(await count(pg, 'tasks', ctx.accountId), 0, 'nothing is written before confirmation');

  const result = await repos.actions.confirm(ctx, action.id);
  assert.equal(result.status, 'applied');
  assert.equal(result.operations.length, 4);
  assert.equal(await count(pg, 'tasks', ctx.accountId), 3);
  assert.equal(await count(pg, 'events', ctx.accountId), 1);
  assert.equal((await repos.captures.get(ctx, capture.id)).status, 'confirmed');
  const task = await repos.tasks.get(ctx, result.operations[1].id);
  assert.equal(task.capture_id, capture.id);
  assert.equal(task.source, 'telegram');
});

test('a failing operation rolls back the whole confirm: zero partial writes', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const capture = await captureInPreview(repos, ctx, 'три дела');
  const existing = await createTask(repos, ctx, { title: 'Старое' });
  const operations = [
    { op: 'create', entity: 'task', data: { title: 'Первое' } },
    { op: 'create', entity: 'note', data: { body: 'Второе' } },
    // Stale version: the user saw version 1, but it has changed since.
    { op: 'update', entity: 'task', id: existing.id, expected_version: 1, patch: { title: 'Третье' } },
  ];
  const action = await repos.actions.propose(ctx, { kind: 'capture', channel: 'telegram', captureId: capture.id, operations });
  await applyOps(repos, ctx, [{ op: 'update', entity: 'task', id: existing.id, expected_version: 1, patch: { priority: 'high' } }]);

  const tasksBefore = await count(pg, 'tasks', ctx.accountId);
  const logBefore = await count(pg, 'activity_log', ctx.accountId);
  await assert.rejects(repos.actions.confirm(ctx, action.id), { code: 'VERSION_CONFLICT' });
  assert.equal(await count(pg, 'tasks', ctx.accountId), tasksBefore);
  assert.equal(await count(pg, 'notes', ctx.accountId), 0);
  assert.equal(await count(pg, 'activity_log', ctx.accountId), logBefore);
  assert.equal((await repos.actions.get(ctx, action.id)).status, 'pending', 'still confirmable after fixing the conflict');
  assert.equal((await repos.captures.get(ctx, capture.id)).status, 'preview');
  assert.equal((await repos.tasks.get(ctx, existing.id)).title, 'Старое');
});

test('a database constraint violation in the last operation also rolls back everything', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const action = await repos.actions.propose(ctx, { kind: 'mutation', channel: 'telegram', operations: [
    { op: 'create', entity: 'task', data: { title: 'A' } },
    { op: 'create', entity: 'task', data: { title: 'B' } },
    // Passes type validation, violates tasks_plan_time_needs_day in the database.
    { op: 'create', entity: 'task', data: { title: 'C', plan_date: '2026-09-28', plan_precision: 'week', plan_time: '10:00' } },
  ] });
  await assert.rejects(repos.actions.confirm(ctx, action.id), { code: 'VALIDATION' });
  assert.equal(await count(pg, 'tasks', ctx.accountId), 0);
  assert.equal(await count(pg, 'activity_log', ctx.accountId), 0);
});

test('partial selection applies only the kept items', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const capture = await captureInPreview(repos, ctx, 'x');
  const action = await repos.actions.propose(ctx, { kind: 'capture', channel: 'telegram', captureId: capture.id, operations: REFERENCE });
  const result = await repos.actions.confirm(ctx, action.id, [3, 0]);
  assert.deepEqual(result.operations.map(o => o.index), [0, 3]);
  assert.equal(await count(pg, 'events', ctx.accountId), 1);
  assert.equal(await count(pg, 'tasks', ctx.accountId), 1);
  assert.deepEqual((await repos.actions.get(ctx, action.id)).selected, [0, 3]);
});

test('confirm is idempotent: a double tap never duplicates records', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const action = await repos.actions.propose(ctx, { kind: 'mutation', channel: 'telegram', operations: REFERENCE });
  const [first, second] = await Promise.all([repos.actions.confirm(ctx, action.id), repos.actions.confirm(ctx, action.id)]);
  const third = await repos.actions.confirm(ctx, action.id);
  assert.equal(await count(pg, 'tasks', ctx.accountId), 3);
  assert.deepEqual(third.operations, first.operations);
  assert.equal([first.replayed, second.replayed, third.replayed].filter(Boolean).length, 2);
});

test('propose is idempotent per key; the same key with other content is refused', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const ops = [{ op: 'create', entity: 'note', data: { body: 'x' } }];
  const first = await repos.actions.propose(ctx, { kind: 'mutation', channel: 'telegram', operations: ops, idempotencyKey: 'msg:1' });
  const again = await repos.actions.propose(ctx, { kind: 'mutation', channel: 'telegram', operations: ops, idempotencyKey: 'msg:1' });
  assert.equal(again.id, first.id);
  await assert.rejects(repos.actions.propose(ctx, { kind: 'mutation', channel: 'telegram', operations: [{ op: 'create', entity: 'note', data: { body: 'y' } }], idempotencyKey: 'msg:1' }), { code: 'DUPLICATE' });
});

test('expired, discarded and foreign states cannot be applied', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const capture = await captureInPreview(repos, ctx, 'x');
  const discarded = await repos.actions.propose(ctx, { kind: 'capture', channel: 'telegram', captureId: capture.id, operations: REFERENCE });
  assert.equal(await repos.actions.discard(ctx, discarded.id), 'discarded');
  assert.equal(await repos.actions.discard(ctx, discarded.id), 'discarded');
  assert.equal((await repos.captures.get(ctx, capture.id)).status, 'discarded');
  await assert.rejects(repos.actions.confirm(ctx, discarded.id), { code: 'INVALID_STATE' });

  const late = await repos.actions.propose(ctx, { kind: 'mutation', channel: 'telegram', operations: REFERENCE, ttlSeconds: 60 });
  await asOwnerRaw(pg, `update izi.pending_actions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id = $1`, [late.id]);
  await assert.rejects(repos.actions.confirm(ctx, late.id), { code: 'ACTION_EXPIRED' });
  assert.equal(await count(pg, 'tasks', ctx.accountId), 0);
});

test('what was previewed is what gets applied: operations are immutable', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const action = await repos.actions.propose(ctx, { kind: 'mutation', channel: 'telegram', operations: [{ op: 'create', entity: 'note', data: { body: 'x' } }] });
  await assert.rejects(pg.query(`update izi.pending_actions set operations = '[{"op":"create","entity":"note","data":{"body":"other"}}]' where id = $1`, [action.id]), { code: 'IZ422' });
  await assert.rejects(pg.query(`update izi.pending_actions set status = 'applied' where id = $1`, [action.id]), error => ['23514', 'IZ423'].includes(error.code));
});

test('the database rejects writable-field smuggling even if TypeScript validation is bypassed', async () => {
  const { account, pg } = await setup();
  const ctx = await account();
  for (const data of [{ title: 'x', account_id: '00000000-0000-4000-8000-000000000000' }, { title: 'x', version: 50 }, { title: 'x', reschedule_count: 9 }]) {
    const action = (await pg.query(`insert into izi.pending_actions (account_id, kind, channel, operations, expires_at) values ($1, 'mutation', 'telegram', $2, now() + interval '1 hour') returning id`,
      [ctx.accountId, JSON.stringify([{ op: 'create', entity: 'task', data }])])).rows[0];
    await assert.rejects(pg.query('select izi.apply_pending_action($1, $2)', [ctx.accountId, action.id]), { code: 'IZ422', message: 'UNKNOWN_FIELD' });
  }
});

test('bulk mutation: reschedule several tasks in one confirmed action', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const tasks = [];
  for (const title of ['A', 'B', 'C']) tasks.push(await createTask(repos, ctx, { title, plan_date: '2026-09-26', plan_precision: 'day' }));
  const { result } = await applyOps(repos, ctx, tasks.map(t => ({ op: 'update', entity: 'task', id: t.id, expected_version: t.version, patch: { plan_date: '2026-09-27' } })));
  assert.equal(result.operations.length, 3);
  for (const t of tasks) {
    const after = await repos.tasks.get(ctx, t.id);
    assert.equal(after.plan_date, '2026-09-27');
    assert.equal(after.reschedule_count, 1);
  }
});

test('activity log records before/after of changed fields only', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const task = await createTask(repos, ctx, { title: 'Позвонить', plan_date: '2026-09-26', plan_precision: 'day', notes: 'длинная заметка' });
  const { action } = await applyOps(repos, ctx, [{ op: 'update', entity: 'task', id: task.id, expected_version: 1, patch: { plan_date: '2026-09-27' } }]);
  const [update] = await repos.activity.forAction(ctx, action.id);
  assert.equal(update.action, 'update');
  assert.equal(update.entity_type, 'task');
  assert.equal(update.entity_id, task.id);
  assert.deepEqual(update.changed_fields, ['plan_date', 'reschedule_count']);
  assert.deepEqual(update.before_state, { plan_date: '2026-09-26', reschedule_count: 0, version: 1 });
  assert.deepEqual(update.after_state, { plan_date: '2026-09-27', reschedule_count: 1, version: 2 });
  assert.equal(update.pending_action_id, action.id);
  assert.equal(update.local_date !== null, true);
  const history = await repos.activity.forEntity(ctx, 'task', task.id);
  assert.deepEqual(history.map(h => h.action), ['update', 'create']);
  assert.equal(history[1].before_state, null);
  assert.equal(history[1].after_state.title, 'Позвонить');
});

test('inbox conversion creates the target and links it atomically', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const inboxId = (await applyOps(repos, ctx, [{ op: 'create', entity: 'inbox_item', data: { text: 'надо изучить Playwright' } }])).result.operations[0].id;
  const { result } = await applyOps(repos, ctx, [{ op: 'convert', entity: 'inbox_item', id: inboxId, expected_version: 1, into: { entity: 'task', data: { title: 'Изучить Playwright' } } }], { kind: 'conversion' });
  const created = result.operations[0].created;
  const item = await repos.inbox.get(ctx, inboxId);
  assert.equal(item.status, 'converted');
  assert.equal(item.converted_entity, 'task');
  assert.equal(item.converted_task_id, created.id);
  assert.equal((await repos.tasks.get(ctx, created.id)).title, 'Изучить Playwright');
  const again = await repos.actions.propose(ctx, { kind: 'conversion', channel: 'telegram', operations: [{ op: 'convert', entity: 'inbox_item', id: inboxId, expected_version: item.version, into: { entity: 'note', data: { body: 'x' } } }] });
  await assert.rejects(repos.actions.confirm(ctx, again.id), { code: 'INVALID_STATE' });
});

test('delete is soft and restore brings the record back', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const task = await createTask(repos, ctx, { title: 'x' });
  const deleted = await applyOps(repos, ctx, [{ op: 'delete', entity: 'task', id: task.id, expected_version: 1 }]);
  assert.equal(await repos.tasks.get(ctx, task.id), null);
  await applyOps(repos, ctx, [{ op: 'restore', entity: 'task', id: task.id, expected_version: deleted.result.operations[0].version }]);
  assert.equal((await repos.tasks.get(ctx, task.id)).title, 'x');
});

test('housekeeping: stale previews expire together with their capture', async () => {
  const { repos, system, account, pg } = await setup();
  const ctx = await account();
  const capture = await captureInPreview(repos, ctx, 'x');
  const action = await repos.actions.propose(ctx, { kind: 'capture', channel: 'telegram', captureId: capture.id, operations: REFERENCE });
  await asOwnerRaw(pg, `update izi.pending_actions set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = $1`, [action.id]);
  assert.equal(await system.housekeeping.expirePendingActions(), 1);
  assert.equal((await repos.actions.get(ctx, action.id)).status, 'expired');
  assert.equal((await repos.captures.get(ctx, capture.id)).status, 'expired');
});

test('housekeeping: purging old actions keeps the activity log intact', async () => {
  const { repos, system, account, pg } = await setup();
  const ctx = await account();
  const { action } = await applyOps(repos, ctx, [{ op: 'create', entity: 'task', data: { title: 'A' } }]);
  await asOwnerRaw(pg, `update izi.pending_actions set updated_at = now() - interval '40 days', undo_until = now() - interval '40 days' where id = $1`, [action.id]);
  assert.equal(await system.housekeeping.purgePendingActions(new Date(Date.now() - 30 * 86400000)), 1);
  const log = (await pg.query('select action, pending_action_id from izi.activity_log where account_id = $1', [ctx.accountId])).rows;
  assert.deepEqual(log, [{ action: 'create', pending_action_id: null }]);
});
