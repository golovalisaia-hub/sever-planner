import test from 'node:test';
import assert from 'node:assert/strict';
import { createPg, migrate, migrationFiles, migrationSql } from '../fakes/db.mjs';

test('migrations apply cleanly on PostgreSQL 17 (Supabase major version)', async () => {
  const pg = await createPg();
  const version = (await pg.query('show server_version_num')).rows[0].server_version_num;
  assert.equal(String(version).slice(0, 2), '17');
  await migrate(pg);
  const tables = (await pg.query(`select tablename from pg_tables where schemaname = 'izi' order by 1`)).rows.map(r => r.tablename);
  assert.deepEqual(tables, [
    'account_settings', 'accounts', 'activity_log', 'ai_runs', 'captures', 'events', 'identities', 'inbound_updates',
    'inbox_items', 'notes', 'pending_actions', 'rate_limits', 'system_config', 'tasks', 'telegram_chats',
  ]);
});

test('migrations create nothing outside the izi schema', async () => {
  const pg = await createPg();
  const before = (await pg.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`)).rows[0].n;
  await migrate(pg);
  const after = (await pg.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`)).rows[0].n;
  assert.equal(after, before);
  const functionsOutside = (await pg.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows[0].n;
  assert.equal(functionsOutside, 0);
});

test('re-running every migration is harmless and keeps data', async () => {
  const pg = await createPg();
  await migrate(pg);
  await pg.query(`select * from izi.resolve_or_create_account('telegram', '4242')`);
  await migrate(pg);
  await migrate(pg);
  const accounts = (await pg.query('select count(*)::int n from izi.identities')).rows[0].n;
  assert.equal(accounts, 1);
  const triggers = (await pg.query(`select count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'izi' and not t.tgisinternal`)).rows[0].n;
  const pg2 = await createPg();
  await migrate(pg2);
  const triggersOnce = (await pg2.query(`select count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'izi' and not t.tgisinternal`)).rows[0].n;
  assert.equal(triggers, triggersOnce, 'no duplicated triggers after re-run');
});

test('migration files are additive: no DROP TABLE/SCHEMA/COLUMN, TRUNCATE, or foreign schemas', () => {
  for (const name of migrationFiles()) {
    const sql = migrationSql(name).replace(/--.*$/gm, '');
    assert.doesNotMatch(sql, /\bdrop\s+(table|schema|column|type|view)\b/i, name);
    assert.doesNotMatch(sql, /\btruncate\b/i, name);
    assert.doesNotMatch(sql, /\bpublic\.[a-z_]/i, `${name} references the public schema`);
    assert.doesNotMatch(sql, /\b(tavro|sever)_[a-z_]+/i, `${name} references donor objects`);
    assert.doesNotMatch(sql, /\bauth\.users\b/i, `${name} depends on Supabase auth.users`);
  }
});

test('every foreign key has a supporting index', async () => {
  const pg = await createPg();
  await migrate(pg);
  const missing = (await pg.query(`
    select c.conrelid::regclass::text as tbl, c.conname
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
     where n.nspname = 'izi' and c.contype = 'f'
       and not exists (
         select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey)`)).rows;
  assert.deepEqual(missing, []);
});

test('every izi table has row level security enabled', async () => {
  const pg = await createPg();
  await migrate(pg);
  const rows = (await pg.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'izi' and c.relkind = 'r'`)).rows;
  assert.ok(rows.length >= 15);
  for (const row of rows) assert.equal(row.relrowsecurity, true, row.relname);
  const policies = (await pg.query(`select count(*)::int n from pg_policies where schemaname = 'izi'`)).rows[0].n;
  assert.equal(policies, 0, 'server-only tables: deny-all, no placeholder policies');
});
