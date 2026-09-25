// Inbound updates: accepted once, processed in order per chat, retried on
// failure, never silently lost (fixes TAVRO T1/T2). No worker runtime yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../fakes/fixtures.mjs';
import { asOwnerRaw } from '../fakes/db.mjs';

const update = (id, chat, text = 'сообщение') => ({ update_id: id, message: { chat: { id: chat }, text } });

test('a duplicate delivery is accepted once', async () => {
  const { system, pg } = await setup();
  assert.equal(await system.inbound.enqueue('telegram', 1001, 'chat:1', update(1001, 1)), true);
  assert.equal(await system.inbound.enqueue('telegram', 1001, 'chat:1', update(1001, 1)), false);
  assert.equal((await pg.query('select count(*)::int n from izi.inbound_updates')).rows[0].n, 1);
});

test('claim -> complete drops the personal payload', async () => {
  const { system, pg } = await setup();
  await system.inbound.enqueue('telegram', 1002, 'chat:2', update(1002, 2, 'личный текст'));
  const [claimed] = await system.inbound.claim('worker-a');
  assert.equal(claimed.status, 'processing');
  assert.equal(claimed.attempt_count, 1);
  assert.equal(claimed.payload.message.text, 'личный текст');
  assert.deepEqual(await system.inbound.claim('worker-b'), [], 'a claimed update is not handed out twice');
  assert.equal(await system.inbound.complete(claimed.id, 'worker-b'), false, 'only the claiming worker can complete');
  assert.equal(await system.inbound.complete(claimed.id, 'worker-a'), true);
  const row = (await pg.query('select status, payload from izi.inbound_updates where id = $1', [claimed.id])).rows[0];
  assert.deepEqual(row, { status: 'done', payload: null });
});

test('a temporary failure is retried with the payload kept; repeated failures end in dead', async () => {
  const { system, pg } = await setup();
  await system.inbound.enqueue('telegram', 1003, 'chat:3', update(1003, 3));
  await pg.query('update izi.inbound_updates set max_attempts = 2');
  let [claimed] = await system.inbound.claim('w');
  assert.equal(await system.inbound.fail(claimed.id, 'w', 'DATABASE_UNAVAILABLE', 1), 'retry');
  assert.deepEqual(await system.inbound.claim('w'), [], 'not before next_attempt_at');
  await asOwnerRaw(pg, `update izi.inbound_updates set next_attempt_at = now() - interval '1 second'`);
  [claimed] = await system.inbound.claim('w');
  assert.equal(claimed.attempt_count, 2);
  assert.ok(claimed.payload, 'payload survives for the retry');
  assert.equal(await system.inbound.fail(claimed.id, 'w', 'DATABASE_UNAVAILABLE', 1), 'dead');
  const row = (await pg.query('select status, last_error_code from izi.inbound_updates')).rows[0];
  assert.deepEqual(row, { status: 'dead', last_error_code: 'DATABASE_UNAVAILABLE' });
});

test('error codes cannot carry message text', async () => {
  const { system, pg } = await setup();
  await system.inbound.enqueue('telegram', 1004, 'chat:4', update(1004, 4));
  const [claimed] = await system.inbound.claim('w');
  await assert.rejects(system.inbound.fail(claimed.id, 'w', 'Не удалось: купить пасту'), { code: 'VALIDATION' });
  await assert.rejects(pg.query(`select izi.fail_inbound_update($1, 'w', 'error: user said hello', 5)`, [claimed.id]), { code: '23514' });
});

test('updates of one chat are processed strictly in order', async () => {
  const { system } = await setup();
  await system.inbound.enqueue('telegram', 2001, 'chat:9', update(2001, 9, 'первое'));
  await system.inbound.enqueue('telegram', 2002, 'chat:9', update(2002, 9, 'второе'));
  await system.inbound.enqueue('telegram', 2003, 'chat:8', update(2003, 8, 'другой чат'));
  const first = await system.inbound.claim('w', 10);
  assert.deepEqual(first.map(u => u.provider_update_id).sort(), ['2001', '2003']);
  assert.deepEqual(await system.inbound.claim('w', 10), [], 'second message waits for the first');
  await system.inbound.complete(first.find(u => u.provider_update_id === '2001').id, 'w');
  const next = await system.inbound.claim('w', 10);
  assert.deepEqual(next.map(u => u.provider_update_id), ['2002']);
});

test('a crashed worker\'s update is recovered, not lost', async () => {
  const { system, pg } = await setup();
  await system.inbound.enqueue('telegram', 3001, 'chat:7', update(3001, 7));
  await system.inbound.claim('dead-worker');
  await asOwnerRaw(pg, `update izi.inbound_updates set locked_at = now() - interval '1 hour'`);
  assert.equal(await system.housekeeping.reapStaleInboundUpdates(), 1);
  const [again] = await system.inbound.claim('healthy-worker');
  assert.equal(again.provider_update_id, '3001');
  assert.equal(again.attempt_count, 2);
});

test('payloads never outlive 30 days', async () => {
  const { system, pg } = await setup();
  await system.inbound.enqueue('telegram', 4001, 'chat:6', update(4001, 6));
  await assert.rejects(pg.query(`update izi.inbound_updates set payload_expires_at = received_at + interval '31 days'`), { code: '23514' });
  await asOwnerRaw(pg, `update izi.inbound_updates set payload_expires_at = now() - interval '1 second'`);
  assert.equal(await system.housekeeping.purgeInboundUpdates(), 1);
  const row = (await pg.query('select status, payload, last_error_code from izi.inbound_updates')).rows[0];
  assert.deepEqual(row, { status: 'dead', payload: null, last_error_code: 'RETENTION_EXPIRED' });
});
