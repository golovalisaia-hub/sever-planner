// Server-only data: public client roles reach nothing, even with a leaked key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, createTask, applyOps } from '../fakes/fixtures.mjs';
import { asRole, asOwner } from '../fakes/db.mjs';

const tables = async pg => (await pg.query(`select tablename from pg_tables where schemaname = 'izi' order by 1`)).rows.map(r => r.tablename);

test('anon and authenticated cannot use the schema, any table or any function', async () => {
  const { pg, account, repos } = await setup();
  const ctx = await account();
  await createTask(repos, ctx, { title: 'x' });
  const names = await tables(pg);
  const functions = (await pg.query(`select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'izi'`)).rows.map(r => r.sig);
  for (const role of ['anon', 'authenticated']) {
    await asRole(pg, role, async () => {
      for (const table of names) {
        await assert.rejects(pg.query(`select 1 from izi.${table} limit 1`), { code: '42501' }, `${role} select ${table}`);
        await assert.rejects(pg.query(`delete from izi.${table}`), { code: '42501' }, `${role} delete ${table}`);
      }
      await assert.rejects(pg.query(`select * from izi.resolve_or_create_account('telegram', '1')`), { code: '42501' });
      await assert.rejects(pg.query(`select izi.apply_pending_action('${ctx.accountId}', gen_random_uuid())`), { code: '42501' });
    });
    const privileges = (await pg.query(`select count(*)::int n from information_schema.role_table_grants where table_schema = 'izi' and grantee = $1`, [role])).rows[0].n;
    assert.equal(privileges, 0, `${role} has no table grants`);
    const executable = [];
    for (const sig of functions) {
      if ((await pg.query('select has_function_privilege($1, $2, \'execute\') as ok', [role, sig])).rows[0].ok) executable.push(sig);
    }
    assert.deepEqual(executable, [], `${role} executes no IZI function`);
    assert.equal((await pg.query(`select has_schema_privilege($1, 'izi', 'usage') as ok`, [role])).rows[0].ok, false);
  }
  const publicExec = (await pg.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'izi' and has_function_privilege('public', p.oid, 'execute')`)).rows[0].n;
  assert.equal(publicExec, 0, 'PUBLIC executes no IZI function');
});

test('RLS denies rows to any role that is not the owner or BYPASSRLS, even with grants', async () => {
  const { pg, account, repos } = await setup();
  const ctx = await account();
  await createTask(repos, ctx, { title: 'x' });
  await asOwner(pg, () => pg.exec(`grant usage on schema izi to server_without_bypass; grant select on izi.tasks to server_without_bypass;`));
  await asRole(pg, 'server_without_bypass', async () => {
    assert.deepEqual((await pg.query('select * from izi.tasks')).rows, []);
  });
});

test('the activity log is append-only for the server role', async () => {
  const { pg, account, repos } = await setup();
  const ctx = await account();
  await applyOps(repos, ctx, [{ op: 'create', entity: 'note', data: { body: 'x' } }]);
  await assert.rejects(pg.query(`update izi.activity_log set action = 'delete'`), { code: '42501' });
  await assert.rejects(pg.query(`delete from izi.activity_log`), { code: '42501' });
  // Even the owner cannot rewrite history, only redact it.
  await asOwner(pg, async () => {
    await assert.rejects(pg.query(`update izi.activity_log set entity_type = 'event'`), { code: 'IZ422' });
    await assert.rejects(pg.query(`update izi.activity_log set after_state = '{"title":"подделка"}'`), { code: 'IZ422' });
  });
});

test('internal helpers are not callable by the server role', async () => {
  const { pg } = await setup();
  await assert.rejects(pg.query('select izi._secure_schema()'), { code: '42501' });
});
