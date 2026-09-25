import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, applyOps } from '../fakes/fixtures.mjs';
import { asOwnerRaw } from '../fakes/db.mjs';

const STATES = ['pending', 'processing', 'needs_clarification', 'preview', 'confirmed', 'discarded', 'failed', 'expired'];
const TERMINAL = ['confirmed', 'discarded', 'expired'];

test('capture state machine: every non-terminal state can progress and can be closed', async () => {
  const { pg } = await setup();
  const allowed = async (from, to) => (await pg.query('select izi.capture_transition_allowed($1, $2) as ok', [from, to])).rows[0].ok;
  for (const state of STATES) {
    const exits = [];
    for (const to of STATES) if (await allowed(state, to)) exits.push(to);
    if (TERMINAL.includes(state)) {
      assert.deepEqual(exits, [], `${state} is terminal`);
    } else {
      assert.ok(exits.some(to => !TERMINAL.includes(to) || to === 'confirmed'), `${state} can progress`);
      assert.ok(exits.includes('discarded') || exits.includes('expired'), `${state} can be closed`);
    }
  }
  assert.equal(await allowed('failed', 'processing'), true, 'a failure is retryable');
  assert.equal(await allowed('confirmed', 'processing'), false);
});

test('capture transitions are compare-and-set and enforced by the database', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const capture = await repos.captures.create(ctx, { source: 'telegram_text', externalRef: '10:20', rawText: 'купить пасту' });
  assert.equal(capture.status, 'pending');
  const processing = await repos.captures.transition(ctx, capture.id, 'pending', 'processing');
  assert.equal(processing.attempt_count, 1);
  await assert.rejects(repos.captures.transition(ctx, capture.id, 'pending', 'processing'), { code: 'INVALID_STATE' });
  await repos.captures.transition(ctx, capture.id, 'processing', 'failed', 'PROVIDER_TIMEOUT');
  const retried = await repos.captures.transition(ctx, capture.id, 'failed', 'processing');
  assert.equal(retried.attempt_count, 2);
  await repos.captures.transition(ctx, capture.id, 'processing', 'needs_clarification');
  await repos.captures.transition(ctx, capture.id, 'needs_clarification', 'processing');
  await repos.captures.transition(ctx, capture.id, 'processing', 'preview');
  await assert.rejects(pg.query(`update izi.captures set status = 'pending' where id = $1`, [capture.id]), { code: 'IZ423' });
  await assert.rejects(repos.captures.transition(ctx, capture.id, 'preview', 'failed', 'Текст ошибки с данными'), { code: 'VALIDATION' });
  await assert.rejects(pg.query(`insert into izi.captures (account_id, source, status) values ($1, 'telegram_text', 'confirmed')`, [ctx.accountId]), { code: 'IZ423' });
});

test('a worker that died mid-processing does not leave a capture stuck', async () => {
  const { repos, system, account, pg } = await setup();
  const ctx = await account();
  const capture = await repos.captures.create(ctx, { source: 'telegram_voice', externalRef: '10:21' });
  await repos.captures.transition(ctx, capture.id, 'pending', 'processing');
  await asOwnerRaw(pg, `update izi.captures set locked_at = now() - interval '1 hour' where id = $1`, [capture.id]);
  assert.equal(await system.housekeeping.reapStaleCaptures(), 1);
  const reaped = await repos.captures.get(ctx, capture.id);
  assert.equal(reaped.status, 'failed');
  assert.equal(reaped.error_code, 'WORKER_TIMEOUT');
  await repos.captures.transition(ctx, capture.id, 'failed', 'processing');
});

test('captures are idempotent per channel message', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  const first = await repos.captures.create(ctx, { source: 'telegram_text', externalRef: '10:22', rawText: 'один' });
  const again = await repos.captures.create(ctx, { source: 'telegram_text', externalRef: '10:22', rawText: 'один' });
  assert.equal(again.id, first.id);
  const other = await repos.captures.create(ctx, { source: 'telegram_text', rawText: 'без ссылки' });
  assert.notEqual(other.id, first.id);
});

test('raw text lives at most 30 days; the bound is a database constraint', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const capture = await repos.captures.create(ctx, { source: 'telegram_text', rawText: 'Завтра стоматолог в 16:00' });
  const expires = new Date(capture.raw_text_expires_at) - new Date(capture.created_at);
  assert.equal(Math.round(expires / 86400000), 30);
  assert.equal(capture.raw_text_length, 'Завтра стоматолог в 16:00'.length);
  await assert.rejects(pg.query(`update izi.captures set raw_text_expires_at = created_at + interval '31 days' where id = $1`, [capture.id]), { constraint: 'captures_raw_text_retention' });
  // A longer requested retention is clamped to 30 days on write.
  const clamped = (await pg.query(`insert into izi.captures (account_id, source, raw_text, raw_text_kind, raw_text_expires_at)
    values ($1, 'telegram_text', 'x', 'typed', now() + interval '60 days') returning (raw_text_expires_at - created_at) = interval '30 days' as ok`, [ctx.accountId])).rows[0];
  assert.equal(clamped.ok, true);
});

test('purging raw text keeps the capture and everything created from it', async () => {
  const { repos, system, account, pg } = await setup();
  const ctx = await account();
  const capture = await repos.captures.create(ctx, { source: 'telegram_text', externalRef: '10:23', rawText: 'купить пасту после стоматолога' });
  await repos.captures.transition(ctx, capture.id, 'pending', 'processing');
  await repos.captures.transition(ctx, capture.id, 'processing', 'preview');
  const action = await repos.actions.propose(ctx, { kind: 'capture', channel: 'telegram', captureId: capture.id, operations: [{ op: 'create', entity: 'task', data: { title: 'Купить пасту' } }] });
  const result = await repos.actions.confirm(ctx, action.id);

  await asOwnerRaw(pg, `update izi.captures set raw_text_expires_at = now() - interval '1 minute' where id = $1`, [capture.id]);
  assert.equal(await system.housekeeping.purgeExpiredRawText(), 1);
  const purged = await repos.captures.get(ctx, capture.id);
  assert.equal(purged.raw_text, null);
  assert.ok(purged.raw_text_purged_at);
  assert.equal(purged.raw_text_length, 'купить пасту после стоматолога'.length, 'metadata survives');
  assert.equal(purged.status, 'confirmed');
  const task = await repos.tasks.get(ctx, result.operations[0].id);
  assert.equal(task.capture_id, capture.id);
  await assert.rejects(pg.query(`update izi.captures set raw_text = 'снова' where id = $1`, [capture.id]), { code: 'IZ422' });
});

test('the activity log never copies capture raw text', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  const secret = 'Сырой текст пользователя 7b1e';
  const capture = await repos.captures.create(ctx, { source: 'telegram_text', externalRef: '10:24', rawText: secret });
  await repos.captures.transition(ctx, capture.id, 'pending', 'processing');
  await repos.captures.transition(ctx, capture.id, 'processing', 'preview');
  const action = await repos.actions.propose(ctx, { kind: 'capture', channel: 'telegram', captureId: capture.id, operations: [{ op: 'create', entity: 'task', data: { title: 'Структурированная задача' } }] });
  await repos.actions.confirm(ctx, action.id);
  const dump = JSON.stringify((await pg.query('select * from izi.activity_log where account_id = $1', [ctx.accountId])).rows);
  assert.doesNotMatch(dump, /7b1e/);
});

test('activity payloads are redacted after retention; facts and dates remain', async () => {
  const { repos, system, account, pg } = await setup();
  const ctx = await account();
  const { result } = await applyOps(repos, ctx, [{ op: 'create', entity: 'task', data: { title: 'Личное название', plan_date: '2026-09-26', plan_precision: 'day' } }]);
  await asOwnerRaw(pg, `update izi.activity_log set payload_expires_at = now() - interval '1 minute' where account_id = $1`, [ctx.accountId]);
  assert.equal(await system.housekeeping.redactActivityPayloads(), 1);
  const [entry] = await repos.activity.forEntity(ctx, 'task', result.operations[0].id);
  assert.equal(entry.after_state.title, undefined);
  assert.equal(entry.after_state.plan_date, '2026-09-26');
  assert.equal(entry.action, 'create');
  assert.ok(entry.payload_redacted_at);
});
