// PHASE 3A — real database contract check.
//
// Runs only when IZI_TEST_DATABASE_URL is set, and only after the database
// proves it is IZI in the expected environment (izi.assert_environment).
// Without a URL every test is reported as SKIPPED, never as passed.
//
// Everything here writes exclusively to the `izi` schema and deletes what it
// created (accounts cascade; inbound updates by run prefix).

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertEnvironment, createPool, databaseUrl } from '../../scripts/phase3a/lib.mjs';

const URL_ = databaseUrl();
const SKIP = URL_ ? false : 'IZI_TEST_DATABASE_URL is not set (real database not available)';
const RUN = `it${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

let pool;
const createdAccounts = new Set();
const telegramId = () => `9${String(Date.now()).slice(-9)}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

test.before(async () => {
  if (SKIP) return;
  pool = createPool(URL_, 25);
  await assertEnvironment(pool, URL_);
});

test.after(async () => {
  if (SKIP || !pool) return;
  const cleanup = [
    () => pool.query(`delete from izi.inbound_updates where provider_update_id like $1`, [`${RUN}%`]),
    () => createdAccounts.size ? pool.query('delete from izi.accounts where id = any($1::uuid[])', [[...createdAccounts]]) : null,
  ];
  const failures = [];
  for (const step of cleanup) { try { await step(); } catch (error) { failures.push(error.code || 'ERROR'); } }
  await pool.end();
  if (failures.length) throw new Error(`cleanup failed: ${failures.join(',')}`);
});

const account = async () => {
  const { rows } = await pool.query(`select account_id from izi.resolve_or_create_account('telegram', $1)`, [telegramId()]);
  createdAccounts.add(rows[0].account_id);
  return rows[0].account_id;
};

const propose = async (accountId, operations) => (await pool.query(
  `insert into izi.pending_actions (account_id, kind, channel, operations, expires_at)
   values ($1, 'mutation', 'system', $2::jsonb, now() + interval '1 hour') returning id`,
  [accountId, JSON.stringify(operations)])).rows[0].id;

test('contract: PostgreSQL version and schema presence', { skip: SKIP }, async () => {
  const { rows } = await pool.query(`select current_setting('server_version_num')::int as num`);
  const major = Math.floor(rows[0].num / 10000);
  if ((process.env.IZI_EXPECTED_ENVIRONMENT || 'staging') === 'staging') assert.equal(major, 17, 'Supabase staging must be PostgreSQL 17');
  else assert.ok(major >= 15, 'features used need PostgreSQL 15+');
  const tables = (await pool.query(`select count(*)::int n from pg_tables where schemaname = 'izi'`)).rows[0].n;
  assert.equal(tables, 15);
});

test('contract: client roles have no access to izi; RLS on every table', { skip: SKIP }, async () => {
  const roles = (await pool.query(`select rolname from pg_roles where rolname in ('anon', 'authenticated')`)).rows.map(r => r.rolname);
  for (const role of [...roles, 'public']) {
    const usage = (await pool.query(`select has_schema_privilege($1, 'izi', 'usage') as ok`, [role])).rows[0].ok;
    assert.equal(usage, false, `${role} has USAGE on izi`);
    const executable = (await pool.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'izi' and has_function_privilege($1, p.oid, 'execute')`, [role])).rows[0].n;
    assert.equal(executable, 0, `${role} can execute izi functions`);
  }
  const grants = (await pool.query(`select count(*)::int n from information_schema.role_table_grants
    where table_schema = 'izi' and grantee in ('anon', 'authenticated', 'PUBLIC')`)).rows[0].n;
  assert.equal(grants, 0);
  const noRls = (await pool.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'izi' and c.relkind = 'r' and not c.relrowsecurity`)).rows;
  assert.deepEqual(noRls, []);
  const policies = (await pool.query(`select count(*)::int n from pg_policies where schemaname = 'izi'`)).rows[0].n;
  assert.equal(policies, 0);
});

test('contract: izi and other schemas do not reference each other', { skip: SKIP }, async () => {
  const crossFks = (await pool.query(`
    select c.conname from pg_constraint c
      join pg_class src on src.oid = c.conrelid join pg_namespace sn on sn.oid = src.relnamespace
      join pg_class dst on dst.oid = c.confrelid join pg_namespace dn on dn.oid = dst.relnamespace
     where c.contype = 'f' and (sn.nspname = 'izi') <> (dn.nspname = 'izi')`)).rows;
  assert.deepEqual(crossFks, []);
  const izFunctionsTouchingOthers = (await pool.query(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'izi' and p.prokind = 'f' and pg_get_functiondef(p.oid) ~* '(public|auth|storage|cron|vault)\\.[a-z_]'`)).rows;
  assert.deepEqual(izFunctionsTouchingOthers, []);
});

test('transaction: a failing operation rolls back the whole confirm', { skip: SKIP }, async () => {
  const accountId = await account();
  const actionId = await propose(accountId, [
    { op: 'create', entity: 'task', data: { title: 'A' } },
    // Violates tasks_plan_week_starts_monday (2026-09-30 is a Wednesday).
    { op: 'create', entity: 'task', data: { title: 'B', plan_date: '2026-09-30', plan_precision: 'week' } },
  ]);
  await assert.rejects(pool.query('select izi.apply_pending_action($1, $2)', [accountId, actionId]), { code: '23514' });
  const count = (await pool.query('select count(*)::int n from izi.tasks where account_id = $1', [accountId])).rows[0].n;
  assert.equal(count, 0);
  const log = (await pool.query('select count(*)::int n from izi.activity_log where account_id = $1', [accountId])).rows[0].n;
  assert.equal(log, 0);
  assert.equal((await pool.query('select status from izi.pending_actions where id = $1', [actionId])).rows[0].status, 'pending');
});

test('A: 20 concurrent resolve_or_create_account with one Telegram ID -> 1 account, 1 identity', { skip: SKIP }, async () => {
  const subject = telegramId();
  const results = await Promise.allSettled(Array.from({ length: 20 }, () =>
    pool.query(`select account_id, created from izi.resolve_or_create_account('telegram', $1)`, [subject])));
  const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value.rows[0]);
  assert.equal(ok.length, 20, `rejections: ${results.filter(r => r.status === 'rejected').map(r => r.reason.code).join(',')}`);
  ok.forEach(r => createdAccounts.add(r.account_id));
  assert.equal(new Set(ok.map(r => r.account_id)).size, 1);
  assert.equal(ok.filter(r => r.created).length, 1);
  const identities = (await pool.query(`select count(*)::int n from izi.identities where provider = 'telegram' and subject = $1`, [subject])).rows[0].n;
  assert.equal(identities, 1);
  const accounts = (await pool.query(`select count(*)::int n from izi.accounts a where a.id in (select account_id from izi.identities where subject = $1)`, [subject])).rows[0].n;
  assert.equal(accounts, 1);
  const orphans = (await pool.query(`select count(*)::int n from izi.accounts a where not exists (select 1 from izi.identities i where i.account_id = a.id) and a.created_at > now() - interval '5 minutes'`)).rows[0].n;
  assert.equal(orphans, 0, 'no orphan accounts left by lost races');
});

test('B: 10 concurrent confirms of one pending action -> applied once', { skip: SKIP }, async () => {
  const accountId = await account();
  const actionId = await propose(accountId, [{ op: 'create', entity: 'task', data: { title: 'Однажды' } }]);
  const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
    pool.query('select izi.apply_pending_action($1, $2) as r', [accountId, actionId])));
  const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value.rows[0].r);
  assert.equal(ok.length, 10, `rejections: ${results.filter(r => r.status === 'rejected').map(r => r.reason.code).join(',')}`);
  assert.equal(ok.filter(r => r.replayed === false).length, 1);
  const tasks = (await pool.query('select count(*)::int n from izi.tasks where account_id = $1', [accountId])).rows[0].n;
  assert.equal(tasks, 1);
});

test('C: 20 concurrent inserts of one Telegram update_id -> one inbound update', { skip: SKIP }, async () => {
  const updateId = `${RUN}-c`;
  const results = await Promise.all(Array.from({ length: 20 }, () =>
    pool.query(`select izi.enqueue_inbound_update('telegram', $1, $2, '{"update_id":1}'::jsonb) as inserted`, [updateId, `${RUN}-chat-c`])));
  assert.equal(results.filter(r => r.rows[0].inserted).length, 1);
  const rows = (await pool.query('select count(*)::int n from izi.inbound_updates where provider_update_id = $1', [updateId])).rows[0].n;
  assert.equal(rows, 1);
  await pool.query('delete from izi.inbound_updates where provider_update_id = $1', [updateId]);
});

test('D: updates of one chat_key are processed in order by competing workers', { skip: SKIP }, async () => {
  const chat = `${RUN}-chat-d`;
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const updateId = `${RUN}-d${i}`;
    ids.push(updateId);
    await pool.query(`select izi.enqueue_inbound_update('telegram', $1, $2, '{"n":1}'::jsonb)`, [updateId, chat]);
  }
  const processed = [];
  let active = 0; let maxActive = 0; let foreign = 0;
  const worker = async name => {
    for (let spins = 0; spins < 200 && processed.length < ids.length && !foreign; spins++) {
      const { rows } = await pool.query(`select id, provider_update_id, chat_key from izi.claim_inbound_updates($1, 10)`, [name]);
      if (!rows.length) { await new Promise(r => setTimeout(r, 5)); continue; }
      // 3A runs before any bot exists: the queue must contain only this test's rows.
      if (rows.some(row => row.chat_key !== chat)) { foreign++; for (const row of rows) await pool.query('select izi.fail_inbound_update($1, $2, $3, 1)', [row.id, name, 'TEST_FOREIGN_ROW']); break; }
      for (const row of rows) {
        active++; maxActive = Math.max(maxActive, active);
        processed.push(row.provider_update_id);
        await new Promise(r => setTimeout(r, 3));
        active--;
        await pool.query('select izi.complete_inbound_update($1, $2)', [row.id, name]);
      }
    }
  };
  await Promise.all(['w1', 'w2', 'w3', 'w4', 'w5'].map(worker));
  assert.equal(foreign, 0, 'the queue contained rows that do not belong to this test');
  assert.deepEqual(processed, ids, 'processing order must equal arrival order');
  assert.equal(maxActive, 1, 'never two updates of one chat in flight');
});
