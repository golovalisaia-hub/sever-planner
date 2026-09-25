import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../fakes/fixtures.mjs';

test('rate limit function has no global lock and no cleanup on the hot path', async () => {
  const { pg } = await setup();
  const body = (await pg.query(`select pg_get_functiondef('izi.rate_limit_hit(uuid,text,integer,integer)'::regprocedure) as src`)).rows[0].src;
  assert.doesNotMatch(body, /advisory/i);
  assert.doesNotMatch(body, /\bdelete\b/i);
  const all = (await pg.query(`select string_agg(pg_get_functiondef(p.oid), '\n') as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'izi'`)).rows[0].src;
  assert.doesNotMatch(all, /pg_advisory/i, 'no advisory locks anywhere in IZI');
});

test('rate limit rows are account-scoped by primary key and cleaned separately', async () => {
  const { repos, system, account, pg } = await setup();
  const a = await account();
  await repos.rateLimits.hit(a, 'capture', 5, 60);
  const key = (await pg.query(`select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'izi.rate_limits'::regclass and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)`)).rows.map(r => r.attname);
  assert.deepEqual(key, ['account_id', 'bucket', 'window_start']);
  assert.equal(await system.housekeeping.cleanupRateLimits(new Date(Date.now() + 3600_000)), 1);
  await assert.rejects(repos.rateLimits.hit(a, 'Bad Bucket', 5, 60), { code: 'VALIDATION' });
});
