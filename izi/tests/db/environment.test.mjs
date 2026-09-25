// The environment marker: a shared Supabase project must prove it is IZI
// staging before any integration test or script writes to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../fakes/fixtures.mjs';
import { asOwner } from '../fakes/db.mjs';

test('no marker after migrations: callers must stop', async () => {
  const { pg } = await setup();
  await assert.rejects(pg.query(`select izi.assert_environment('staging')`), { code: 'IZ423', message: 'ENVIRONMENT_MARKER_MISSING' });
});

test('marker must match product and environment; it is immutable and read-only for the server', async () => {
  const { pg } = await setup();
  await assert.rejects(pg.query(`insert into izi.system_config (product, environment, declared_by) values ('izi_planner', 'staging', 'test')`), { code: '42501' });
  await asOwner(pg, async () => {
    await assert.rejects(pg.query(`insert into izi.system_config (product, environment, declared_by) values ('academy', 'staging', 'test')`), { code: '23514' });
    await pg.query(`insert into izi.system_config (product, environment, declared_by) values ('izi_planner', 'staging', 'owner')`);
    await assert.rejects(pg.query(`insert into izi.system_config (product, environment, declared_by) values ('izi_planner', 'production', 'owner')`), { code: '23505' });
    await assert.rejects(pg.query(`update izi.system_config set environment = 'production'`), { code: 'IZ422' });
  });
  assert.equal((await pg.query(`select izi.assert_environment('staging') as e`)).rows[0].e, 'staging');
  await assert.rejects(pg.query(`select izi.assert_environment('production')`), { message: 'ENVIRONMENT_MISMATCH' });
  await assert.rejects(pg.query(`update izi.system_config set environment = 'production'`), { code: '42501' });
});
