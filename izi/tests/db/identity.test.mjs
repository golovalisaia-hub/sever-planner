import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, createTask } from '../fakes/fixtures.mjs';
import { trustVerifiedIdentity } from '../../src/core/identity/trusted.ts';
import { requireContext } from '../../src/core/context.ts';

test('one Telegram identity resolves to exactly one account, repeatedly', async () => {
  const { repos, pg } = await setup();
  const identity = trustVerifiedIdentity('telegram', 555001, 'test');
  const first = await repos.accounts.resolveOrCreate(identity);
  const second = await repos.accounts.resolveOrCreate(trustVerifiedIdentity('telegram', '555001', 'test'));
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.context.accountId, second.context.accountId);
  assert.equal((await pg.query(`select count(*)::int n from izi.accounts`)).rows[0].n, 1);
  const settings = await repos.accounts.settings(first.context);
  assert.deepEqual(settings, { timezone: null, timezone_source: 'unknown', version: 1 });
});

test('concurrent first contacts do not create two accounts', async () => {
  const { repos, pg } = await setup();
  const identity = trustVerifiedIdentity('telegram', 555002, 'test');
  const results = await Promise.all([1, 2, 3].map(() => repos.accounts.resolveOrCreate(identity)));
  assert.equal(new Set(results.map(r => r.context.accountId)).size, 1);
  assert.equal((await pg.query(`select count(*)::int n from izi.identities where subject = '555002'`)).rows[0].n, 1);
});

test('a Telegram id can never be linked to a second account', async () => {
  const { repos, pg } = await setup();
  const a = await repos.accounts.resolveOrCreate(trustVerifiedIdentity('telegram', 555003, 'test'));
  const b = await repos.accounts.resolveOrCreate(trustVerifiedIdentity('email', 'Person@Example.org', 'test'));
  await assert.rejects(repos.accounts.linkIdentity(b.context, trustVerifiedIdentity('telegram', 555003, 'test')), { code: 'IDENTITY_TAKEN' });
  // Directly in SQL as well: the unique constraint is the last line of defence.
  await assert.rejects(pg.query(`insert into izi.identities (account_id, provider, subject) values ($1, 'telegram', '555003')`, [b.context.accountId]), { code: '23505' });
  // Linking is idempotent for the owner.
  const again = await repos.accounts.linkIdentity(a.context, trustVerifiedIdentity('telegram', 555003, 'test'));
  assert.equal(again, a.context.identityId);
});

test('an account has at most one Telegram identity; email is normalised', async () => {
  const { repos } = await setup();
  const a = await repos.accounts.resolveOrCreate(trustVerifiedIdentity('telegram', 555004, 'test'));
  await assert.rejects(repos.accounts.linkIdentity(a.context, trustVerifiedIdentity('telegram', 555005, 'test')), { code: 'DUPLICATE' });
  await repos.accounts.linkIdentity(a.context, trustVerifiedIdentity('email', ' Me@Example.ORG ', 'test'));
  const same = await repos.accounts.find(trustVerifiedIdentity('email', 'me@example.org', 'test'));
  assert.equal(same.accountId, a.context.accountId);
});

test('identity subjects are validated in the database too', async () => {
  const { pg, repos } = await setup();
  const a = await repos.accounts.resolveOrCreate(trustVerifiedIdentity('telegram', 555006, 'test'));
  for (const [provider, subject] of [['telegram', '-5'], ['telegram', 'abc'], ['email', 'Upper@Case.org'], ['web', 'not-a-uuid'], ['facebook', '1']]) {
    await assert.rejects(pg.query(`insert into izi.identities (account_id, provider, subject) values ($1, $2, $3)`, [a.context.accountId, provider, subject]), { code: '23514' }, `${provider}:${subject}`);
  }
});

test('contexts cannot be forged and identities cannot be asserted by clients', async () => {
  const { repos } = await setup();
  const real = await repos.accounts.resolveOrCreate(trustVerifiedIdentity('telegram', 555007, 'test'));
  const forged = { accountId: real.context.accountId, identityId: null };
  assert.throws(() => requireContext(forged), { code: 'CONTEXT_REQUIRED' });
  await assert.rejects(repos.tasks.listOpen(forged), { code: 'CONTEXT_REQUIRED' });
  await assert.rejects(repos.accounts.resolveOrCreate({ provider: 'telegram', subject: '555007', verifiedBy: 'client' }), { code: 'IDENTITY_UNVERIFIED' });
  assert.throws(() => trustVerifiedIdentity('telegram', '0123', 'test'), { code: 'IDENTITY_UNVERIFIED' });
  assert.throws(() => trustVerifiedIdentity('telegram', 5.5, 'test'), { code: 'IDENTITY_UNVERIFIED' });
});

test('a private Telegram chat can only belong to the account owning that Telegram id', async () => {
  const { repos } = await setup();
  const a = await repos.accounts.resolveOrCreate(trustVerifiedIdentity('telegram', 555008, 'test'));
  const b = await repos.accounts.resolveOrCreate(trustVerifiedIdentity('telegram', 555009, 'test'));
  await repos.accounts.registerTelegramChat(a.context, 555008);
  await repos.accounts.registerTelegramChat(a.context, 555008);
  // Rejected before any conflict handling: B does not own Telegram id 555008.
  await assert.rejects(repos.accounts.registerTelegramChat(b.context, 555008), { code: 'VALIDATION' });
  await assert.rejects(repos.accounts.registerTelegramChat(b.context, 777777), { code: 'VALIDATION' });
});

test('timezone: IANA only; a client hint never overrides the user\'s choice', async () => {
  const { repos, pg } = await setup();
  const { context } = await repos.accounts.resolveOrCreate(trustVerifiedIdentity('telegram', 555010, 'test'));
  await repos.accounts.setTimezone(context, 'Asia/Yekaterinburg', 'client_hint');
  await repos.accounts.setTimezone(context, 'Europe/Moscow', 'user');
  const after = await repos.accounts.setTimezone(context, 'Asia/Tokyo', 'client_hint');
  assert.equal(after.timezone, 'Europe/Moscow');
  assert.equal(after.timezone_source, 'user');
  await assert.rejects(repos.accounts.setTimezone(context, 'UTC+3', 'user'), { code: 'INVALID_TIMEZONE' });
  await assert.rejects(pg.query(`update izi.account_settings set timezone = 'Mars/Base' where account_id = $1`, [context.accountId]), { code: 'IZ422' });
});

test('deleting an account removes everything it owns', async () => {
  const { repos, pg, account } = await setup();
  const keep = await account();
  const gone = await account();
  const capture = await repos.captures.create(gone, { source: 'telegram_text', externalRef: 'c:1', rawText: 'купить пасту' });
  await createTask(repos, gone, { title: 'Купить пасту' });
  await createTask(repos, keep, { title: 'Остаётся' });
  await repos.rateLimits.hit(gone, 'capture', 10, 60);
  await repos.actions.propose(gone, { kind: 'capture', channel: 'telegram', captureId: capture.id, operations: [{ op: 'create', entity: 'note', data: { body: 'x' } }] });
  await repos.accounts.deleteAccount(gone);
  for (const table of ['identities', 'account_settings', 'captures', 'tasks', 'pending_actions', 'activity_log', 'rate_limits']) {
    const n = (await pg.query(`select count(*)::int n from izi.${table} where account_id = $1`, [gone.accountId])).rows[0].n;
    assert.equal(n, 0, table);
  }
  assert.equal((await repos.tasks.listOpen(keep)).length, 1);
});
