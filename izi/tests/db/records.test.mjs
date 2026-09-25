import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, applyOps, createTask } from '../fakes/fixtures.mjs';
import { MODULES } from '../../src/modules/registry.ts';

const insertTask = (pg, accountId, fields) => {
  const columns = Object.keys(fields);
  return pg.query(
    `insert into izi.tasks (account_id, source, ${columns.join(', ')}) values ($1, 'system', ${columns.map((_, i) => `$${i + 2}`).join(', ')}) returning *`,
    [accountId, ...Object.values(fields)]);
};

test('task: planned date and deadline are separate columns', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const planned = await createTask(repos, ctx, { title: 'Созвон', plan_date: '2026-10-02', plan_precision: 'day' });
  const due = await createTask(repos, ctx, { title: 'Оплатить интернет', due_date: '2026-10-02' });
  assert.equal(planned.plan_date, '2026-10-02');
  assert.equal(planned.due_date, null);
  assert.equal(due.plan_date, null);
  assert.equal(due.due_date, '2026-10-02');
  assert.deepEqual((await repos.tasks.listPlannedFor(ctx, '2026-10-02')).map(t => t.title), ['Созвон']);
  assert.deepEqual((await repos.tasks.listDueBy(ctx, '2026-10-02')).map(t => t.title), ['Оплатить интернет']);
});

test('task: part of day never produces an exact time', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const task = await createTask(repos, ctx, { title: 'Английский', plan_date: '2026-09-25', plan_precision: 'day', part_of_day: 'evening', duration_minutes: 30 });
  assert.equal(task.part_of_day, 'evening');
  assert.equal(task.plan_time, null);
  await assert.rejects(insertTask(pg, ctx.accountId, { title: 'x', plan_date: '2026-09-25', plan_precision: 'day', plan_time: '18:00', part_of_day: 'evening' }),
    { constraint: 'tasks_time_or_part_of_day' });
});

test('task: vague plans keep their precision; times need a single day', async () => {
  const { account, pg } = await setup();
  const ctx = await account();
  const week = (await insertTask(pg, ctx.accountId, { title: 'Разобрать гараж', plan_date: '2026-09-28', plan_precision: 'week' })).rows[0];
  assert.equal(week.plan_precision, 'week');
  await assert.rejects(insertTask(pg, ctx.accountId, { title: 'x', plan_date: '2026-09-30', plan_precision: 'week' }), { constraint: 'tasks_plan_week_starts_monday' });
  await assert.rejects(insertTask(pg, ctx.accountId, { title: 'x', plan_date: '2026-10-02', plan_precision: 'month' }), { constraint: 'tasks_plan_month_starts_first' });
  await assert.rejects(insertTask(pg, ctx.accountId, { title: 'x', plan_date: '2026-09-28', plan_precision: 'week', plan_time: '10:00' }), { constraint: 'tasks_plan_time_needs_day' });
  await assert.rejects(insertTask(pg, ctx.accountId, { title: 'x', plan_date: '2026-09-28' }), { constraint: 'tasks_plan_precision' });
  await assert.rejects(insertTask(pg, ctx.accountId, { title: 'x', due_time: '10:00' }), { constraint: 'tasks_due_time_needs_date' });
  await assert.rejects(insertTask(pg, ctx.accountId, { title: 'x', plan_date: '2026-09-28', plan_precision: 'day', plan_time: '10:00:30' }), { constraint: 'tasks_whole_minutes' });
});

test('task: an exact time needs a known timezone (never guessed)', async () => {
  const { repos, account } = await setup();
  const noZone = await account({ timezone: null });
  await assert.rejects(createTask(repos, noZone, { title: 'Стоматолог', plan_date: '2026-09-26', plan_precision: 'day', plan_time: '16:00' }), { code: 'TIMEZONE_REQUIRED' });
  const withoutTime = await createTask(repos, noZone, { title: 'Купить пасту' });
  assert.equal(withoutTime.timezone, null);
  const zoned = await account({ timezone: 'Asia/Novosibirsk' });
  const task = await createTask(repos, zoned, { title: 'Стоматолог', plan_date: '2026-09-26', plan_precision: 'day', plan_time: '16:00' });
  assert.equal(task.timezone, 'Asia/Novosibirsk');
  assert.equal(task.plan_time, '16:00');
});

test('task: completion and reschedule history are server-derived', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const task = await createTask(repos, ctx, { title: 'Позвонить', plan_date: '2026-09-25', plan_precision: 'day' });
  const moved = await applyOps(repos, ctx, [{ op: 'update', entity: 'task', id: task.id, expected_version: 1, patch: { plan_date: '2026-09-26' } }]);
  const done = await applyOps(repos, ctx, [{ op: 'update', entity: 'task', id: task.id, expected_version: moved.result.operations[0].version, patch: { status: 'done' } }]);
  const after = await repos.tasks.get(ctx, task.id);
  assert.equal(after.reschedule_count, 1);
  assert.equal(after.status, 'done');
  assert.ok(after.completed_at instanceof Date);
  assert.equal(after.version, done.result.operations[0].version);
  assert.equal(after.version, 3);
});

test('event: date, time and duration may all be null; no default duration', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const { result } = await applyOps(repos, ctx, [{ op: 'create', entity: 'event', data: { title: 'Встреча с Андреем' } }]);
  const event = await repos.events.get(ctx, result.operations[0].id);
  assert.equal(event.start_date, null);
  assert.equal(event.start_time, null);
  assert.equal(event.duration_minutes, null);
  assert.equal(event.status, 'planned');
});

test('event: wall clock is kept, the instant is derived in the event timezone', async () => {
  const { repos, account } = await setup();
  const ctx = await account({ timezone: 'Europe/Moscow' });
  const { result } = await applyOps(repos, ctx, [{ op: 'create', entity: 'event', data: {
    title: 'Стоматолог', start_date: '2026-09-26', start_time: '16:00', location: 'Клиника', participants: ['Андрей'] } }]);
  const event = await repos.events.get(ctx, result.operations[0].id);
  assert.equal(event.start_time, '16:00');
  assert.equal(event.timezone, 'Europe/Moscow');
  assert.equal(event.starts_at.toISOString(), '2026-09-26T13:00:00.000Z');
  assert.equal(event.duration_minutes, null);
  assert.deepEqual((await repos.events.listOn(ctx, '2026-09-26')).map(e => e.title), ['Стоматолог']);
});

test('notes: full-text search with Russian morphology, scoped to the account', async () => {
  const { repos, account } = await setup();
  const a = await account();
  const b = await account();
  await applyOps(repos, a, [
    { op: 'create', entity: 'note', data: { title: 'Покупки', body: 'Купил зубную пасту после стоматолога' } },
    { op: 'create', entity: 'note', data: { body: 'Идея: изучить Playwright' } },
  ]);
  await applyOps(repos, b, [{ op: 'create', entity: 'note', data: { body: 'Зубная паста у соседа' } }]);
  const found = await repos.notes.search(a, 'паста');
  assert.deepEqual(found.map(n => n.title), ['Покупки']);
  assert.deepEqual((await repos.notes.search(a, 'стоматолог')).length, 1);
  assert.deepEqual((await repos.notes.search(a, 'кофе')).length, 0);
});

test('inbox: its own entity with an explicit lifecycle', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const { result } = await applyOps(repos, ctx, [{ op: 'create', entity: 'inbox_item', data: { text: 'надо изучить Playwright' } }]);
  const item = await repos.inbox.get(ctx, result.operations[0].id);
  assert.equal(item.status, 'unprocessed');
  assert.deepEqual((await repos.inbox.listUnprocessed(ctx)).map(i => i.text), ['надо изучить Playwright']);
  await assert.rejects(pg.query(`update izi.inbox_items set status = 'converted' where id = $1`, [item.id]), { constraint: 'inbox_items_conversion' });
  const archived = await applyOps(repos, ctx, [{ op: 'update', entity: 'inbox_item', id: item.id, expected_version: 1, patch: { status: 'archived' } }]);
  assert.equal(archived.result.operations[0].version, 2);
  assert.equal((await repos.inbox.listUnprocessed(ctx)).length, 0);
});

test('server-owned columns cannot be preset on insert', async () => {
  const { account, pg } = await setup();
  const ctx = await account();
  const row = (await insertTask(pg, ctx.accountId, { title: 'x', version: 99, reschedule_count: 5, deleted_at: '2020-01-01T00:00:00Z' })).rows[0];
  assert.equal(row.version, 1);
  assert.equal(row.reschedule_count, 0);
  assert.equal(row.deleted_at, null);
});

test('account_id and id are immutable; version always increments', async () => {
  const { repos, account, pg } = await setup();
  const a = await account();
  const b = await account();
  const task = await createTask(repos, a, { title: 'x' });
  await assert.rejects(pg.query('update izi.tasks set account_id = $1 where id = $2', [b.accountId, task.id]), { code: 'IZ422' });
  await pg.query('update izi.tasks set version = 1, title = $1 where id = $2', ['y', task.id]);
  assert.equal((await pg.query('select version from izi.tasks where id = $1', [task.id])).rows[0].version, 2);
});

test('TypeScript module specs and SQL writable columns stay in sync', async () => {
  const { pg } = await setup();
  for (const module of Object.values(MODULES)) {
    const sql = (await pg.query('select izi.entity_writable_columns($1) as c, izi.entity_table($1) as t', [module.entity])).rows[0];
    assert.deepEqual([...sql.c].sort(), Object.keys(module.writable).sort(), module.entity);
    assert.equal(sql.t, module.table);
    const columns = (await pg.query(`select column_name from information_schema.columns where table_schema = 'izi' and table_name = $1`, [module.table])).rows.map(r => r.column_name);
    for (const column of module.readColumns) assert.ok(columns.includes(column), `${module.table}.${column}`);
  }
});
