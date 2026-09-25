// Identity, ownership and privilege are server-owned: every entrypoint that
// accepts client-shaped input rejects them, and nothing lets a client choose
// whose data it touches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../fakes/fixtures.mjs';

const FORBIDDEN = { account_id: '3fc03172-68d4-4709-aabc-d03a5993d423', role: 'owner', entitlement: 'pro', telegram_id: 1, userId: 'x' };

test('client-controlled identity/privilege fields are rejected at every repository entrypoint', async () => {
  const { repos, account } = await setup();
  const ctx = await account();
  for (const [key, value] of Object.entries(FORBIDDEN)) {
    await assert.rejects(repos.captures.create(ctx, { source: 'telegram_text', rawText: 'x', [key]: value }), { code: 'FORBIDDEN_FIELD' }, `capture ${key}`);
    await assert.rejects(repos.actions.propose(ctx, { kind: 'mutation', channel: 'telegram', operations: [{ op: 'create', entity: 'note', data: { body: 'x' } }], [key]: value }), { code: 'FORBIDDEN_FIELD' }, `action ${key}`);
    await assert.rejects(repos.actions.propose(ctx, { kind: 'mutation', channel: 'telegram', operations: [{ op: 'create', entity: 'note', data: { body: 'x', [key]: value } }] }), { code: 'FORBIDDEN_FIELD' }, `operation data ${key}`);
    await assert.rejects(repos.aiRuns.start(ctx, { requestKey: 'k', purpose: 'interpret', provider: 'openai', model: 'm', usageDate: '2026-09-25', [key]: value }), { code: 'FORBIDDEN_FIELD' }, `ai run ${key}`);
    await assert.rejects(repos.tasks.listOpen(ctx, { limit: 5, [key]: value }), { code: 'FORBIDDEN_FIELD' }, `pagination ${key}`);
  }
});

test('whose data is touched comes only from the context, never from arguments', async () => {
  const { repos, account } = await setup();
  const a = await account();
  const b = await account();
  const action = await repos.actions.propose(a, { kind: 'mutation', channel: 'telegram', operations: [{ op: 'create', entity: 'task', data: { title: 'моя' } }] });
  const result = await repos.actions.confirm(a, action.id);
  assert.ok(await repos.tasks.get(a, result.operations[0].id));
  assert.equal(await repos.tasks.get(b, result.operations[0].id), null);
});

test('AI accounting has no place for personal content', async () => {
  const { repos, account, pg } = await setup();
  const ctx = await account();
  await assert.rejects(repos.aiRuns.start(ctx, { requestKey: 'k', purpose: 'interpret', provider: 'openai', model: 'm', usageDate: '2026-09-25', prompt: 'купить пасту' }), { code: 'UNKNOWN_FIELD' });
  const run = await repos.aiRuns.start(ctx, { requestKey: 'msg:1', purpose: 'interpret', provider: 'openai', model: 'model-from-config', usageDate: '2026-09-25' });
  const again = await repos.aiRuns.start(ctx, { requestKey: 'msg:1', purpose: 'interpret', provider: 'openai', model: 'model-from-config', usageDate: '2026-09-25' });
  assert.equal(again.id, run.id, 'a retried request reuses its accounting row');
  await repos.aiRuns.finish(ctx, run.id, { status: 'succeeded', inputTokens: 120, outputTokens: 80, latencyMs: 900 });
  const columns = (await pg.query(`select column_name from information_schema.columns where table_schema = 'izi' and table_name = 'ai_runs'`)).rows.map(r => r.column_name);
  for (const forbidden of ['prompt', 'input', 'output', 'text', 'transcript', 'phrase', 'response']) assert.ok(!columns.includes(forbidden), forbidden);
});
