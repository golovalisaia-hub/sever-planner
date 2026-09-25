// Service role bypasses RLS, so ownership is enforced by the schema itself
// (composite foreign keys) and by the repository layer (account context).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, applyOps, createTask } from '../fakes/fixtures.mjs';

test('composite foreign keys make cross-account links impossible in SQL', async () => {
  const { repos, account, pg } = await setup();
  const a = await account();
  const b = await account();
  const captureB = await repos.captures.create(b, { source: 'telegram_text', rawText: 'чужое' });
  const taskB = await createTask(repos, b, { title: 'Задача B' });
  const inboxA = (await applyOps(repos, a, [{ op: 'create', entity: 'inbox_item', data: { text: 'мысль' } }])).result.operations[0].id;
  const actionB = await repos.actions.propose(b, { kind: 'mutation', channel: 'telegram', operations: [{ op: 'create', entity: 'note', data: { body: 'x' } }] });

  // A's task pointing at B's capture.
  await assert.rejects(pg.query(`insert into izi.tasks (account_id, source, title, capture_id) values ($1, 'system', 'x', $2)`, [a.accountId, captureB.id]), { code: '23503' });
  // A's inbox item converted into B's task.
  await assert.rejects(pg.query(`update izi.inbox_items set status = 'converted', converted_entity = 'task', converted_task_id = $2 where id = $1`, [inboxA, taskB.id]), { code: '23503' });
  // A's pending action on B's capture.
  await assert.rejects(pg.query(`insert into izi.pending_actions (account_id, kind, channel, capture_id, operations, expires_at) values ($1, 'capture', 'telegram', $2, '[{"op":"create"}]', now() + interval '1 hour')`, [a.accountId, captureB.id]), { code: '23503' });
  // A's activity entry attached to B's pending action.
  await assert.rejects(pg.query(`insert into izi.activity_log (account_id, actor, channel, entity_type, entity_id, action, pending_action_id) values ($1, 'user', 'system', 'task', $2, 'update', $3)`, [a.accountId, taskB.id, actionB.id]), { code: '23503' });
  // A's AI run on B's capture.
  await assert.rejects(pg.query(`insert into izi.ai_runs (account_id, capture_id, request_key, purpose, provider, model, usage_date) values ($1, $2, 'k', 'interpret', 'openai', 'm', current_date)`, [a.accountId, captureB.id]), { code: '23503' });
});

test('repositories never read another account\'s records', async () => {
  const { repos, account } = await setup();
  const a = await account();
  const b = await account();
  const taskB = await createTask(repos, b, { title: 'Секрет B', plan_date: '2026-09-26', plan_precision: 'day' });
  const captureB = await repos.captures.create(b, { source: 'telegram_text', rawText: 'секрет' });
  const actionB = await repos.actions.propose(b, { kind: 'mutation', channel: 'telegram', operations: [{ op: 'create', entity: 'note', data: { body: 'x' } }] });

  assert.equal(await repos.tasks.get(a, taskB.id), null);
  assert.deepEqual(await repos.tasks.listPlannedFor(a, '2026-09-26'), []);
  assert.equal(await repos.captures.get(a, captureB.id), null);
  assert.equal(await repos.actions.get(a, actionB.id), null);
  assert.equal(await repos.actions.getByShortToken(a, actionB.shortToken), null);
  assert.deepEqual(await repos.activity.forEntity(a, 'task', taskB.id), []);
});

test('an account cannot confirm, discard or undo another account\'s action', async () => {
  const { repos, account, pg } = await setup();
  const a = await account();
  const b = await account();
  const actionB = await repos.actions.propose(b, { kind: 'mutation', channel: 'telegram', operations: [{ op: 'create', entity: 'note', data: { body: 'x' } }] });
  await assert.rejects(repos.actions.confirm(a, actionB.id), { code: 'NOT_FOUND' });
  await assert.rejects(repos.actions.discard(a, actionB.id), { code: 'NOT_FOUND' });
  await assert.rejects(repos.actions.undo(a, actionB.id), { code: 'NOT_FOUND' });
  // Even calling the SQL function directly with A's account id.
  await assert.rejects(pg.query('select izi.apply_pending_action($1, $2)', [a.accountId, actionB.id]), { code: 'IZ404' });
  assert.equal((await repos.actions.get(b, actionB.id)).status, 'pending');
});

test('operations that target another account\'s record fail and change nothing', async () => {
  const { repos, account } = await setup();
  const a = await account();
  const b = await account();
  const taskB = await createTask(repos, b, { title: 'Не трогать' });
  for (const op of [
    { op: 'update', entity: 'task', id: taskB.id, expected_version: 1, patch: { title: 'Взломано' } },
    { op: 'delete', entity: 'task', id: taskB.id, expected_version: 1 },
  ]) {
    const action = await repos.actions.propose(a, { kind: 'mutation', channel: 'telegram', operations: [op] });
    await assert.rejects(repos.actions.confirm(a, action.id), { code: 'NOT_FOUND' });
  }
  const untouched = await repos.tasks.get(b, taskB.id);
  assert.equal(untouched.title, 'Не трогать');
  assert.equal(untouched.version, 1);
});

test('rate limits are keyed by account', async () => {
  const { repos, account } = await setup();
  const a = await account();
  const b = await account();
  assert.equal(await repos.rateLimits.hit(a, 'capture', 2, 60), true);
  assert.equal(await repos.rateLimits.hit(a, 'capture', 2, 60), true);
  assert.equal(await repos.rateLimits.hit(a, 'capture', 2, 60), false);
  assert.equal(await repos.rateLimits.hit(b, 'capture', 2, 60), true, 'B has its own window');
  assert.equal(await repos.rateLimits.hit(a, 'ask', 2, 60), true, 'buckets are independent');
});
