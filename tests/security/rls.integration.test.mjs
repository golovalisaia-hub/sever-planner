import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const config = {
  url: process.env.SEVER_RLS_TEST_URL?.replace(/\/$/, ''),
  anonKey: process.env.SEVER_RLS_TEST_ANON_KEY,
  emailA: process.env.SEVER_RLS_USER_A_EMAIL,
  passwordA: process.env.SEVER_RLS_USER_A_PASSWORD,
  emailB: process.env.SEVER_RLS_USER_B_EMAIL,
  passwordB: process.env.SEVER_RLS_USER_B_PASSWORD
};
const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);

async function unpack(response) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data, text };
}
async function signIn(email, password) {
  const result = await unpack(await fetch(config.url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  }));
  assert.equal(result.response.ok, true, 'Test-user sign-in failed: ' + result.response.status + ' ' + result.text);
  assert.ok(result.data?.access_token && result.data?.user?.id, 'Supabase sign-in returned no session');
  return { token: result.data.access_token, user: result.data.user };
}
async function rest(session, table, query = '', options = {}) {
  const headers = {
    apikey: config.anonKey,
    Authorization: 'Bearer ' + session.token,
    Accept: 'application/json',
    Prefer: options.prefer || 'return=representation'
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return unpack(await fetch(config.url + '/rest/v1/' + table + query, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  }));
}
async function expectOk(result, context) {
  assert.equal(result.response.ok, true, context + ': ' + result.response.status + ' ' + result.text);
  return result.data;
}
async function insert(session, table, body, onConflict = '') {
  const result = await rest(session, table, onConflict ? '?on_conflict=' + onConflict : '', {
    method: 'POST',
    prefer: 'return=representation' + (onConflict ? ',resolution=merge-duplicates' : ''),
    body
  });
  const rows = await expectOk(result, 'Create ' + table);
  assert.ok(Array.isArray(rows) && rows[0], 'Create ' + table + ' returned no row');
  return rows[0];
}
async function createFixtures(session, label) {
  const stamp = label + '_' + Date.now() + '_' + randomUUID().slice(0, 8);
  const task = await insert(session, 'tasks', { id: randomUUID(), user_id: session.user.id, title: 'RLS task ' + stamp, scheduled_for: '2099-01-01', duration_minutes: 15, category: 'RLS', priority: false, challenge: false, completed: false });
  const habit = await insert(session, 'habits', { id: randomUUID(), user_id: session.user.id, title: 'RLS habit ' + stamp });
  const habitEntry = await insert(session, 'habit_entries', { user_id: session.user.id, habit_id: habit.id, entry_date: '2099-01-01', completed: true });
  const folder = await insert(session, 'note_folders', { id: randomUUID(), user_id: session.user.id, name: 'RLS folder ' + stamp });
  const note = await insert(session, 'notes', { id: randomUUID(), user_id: session.user.id, folder_id: folder.id, title: 'RLS note ' + stamp, body: 'isolation marker', kind: 'text', items: [], done: false, protected: false, secure: null });
  const protectedNote = await insert(session, 'notes', { id: randomUUID(), user_id: session.user.id, folder_id: folder.id, title: '', body: '', kind: 'protected', items: [], done: false, protected: true, secure: { version: 2, algorithm: 'AES-GCM', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' }, iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA' } });
  const focus = await insert(session, 'focus_sessions', { id: randomUUID(), user_id: session.user.id, task_id: task.id, duration_minutes: 15, status: 'completed', completed_at: new Date().toISOString() });
  const settings = await insert(session, 'user_settings', { user_id: session.user.id, data: { rlsTest: stamp } }, 'user_id');
  const profiles = await expectOk(await rest(session, 'profiles', '?id=eq.' + session.user.id + '&select=*'), 'Read own profile');
  assert.equal(profiles.length, 1, 'Disposable user has no profile; apply migrations first');
  return { task, habit, habitEntry, folder, note, protectedNote, focus, settings, profile: profiles[0] };
}
function targets(f) {
  return [
    ['profiles', 'id', f.profile, { email: 'rls-attacker@example.invalid' }],
    ['tasks', 'id', f.task, { title: 'RLS_CROSS_USER_MUTATION' }],
    ['habits', 'id', f.habit, { title: 'RLS_CROSS_USER_MUTATION' }],
    ['habit_entries', 'id', f.habitEntry, { completed: false }],
    ['note_folders', 'id', f.folder, { name: 'RLS_CROSS_USER_MUTATION' }],
    ['notes', 'id', f.note, { body: 'RLS_CROSS_USER_MUTATION' }],
    ['focus_sessions', 'id', f.focus, { status: 'cancelled' }],
    ['user_settings', 'user_id', f.settings, { data: { rlsTest: 'RLS_CROSS_USER_MUTATION' } }]
  ].map(([table, key, row, patch]) => ({ table, key, row, patch }));
}
function attackRow(target, attacker, attackerFixtures) {
  if (target.table === 'profiles' || target.table === 'user_settings') return { ...target.row, ...target.patch };
  const row = { ...target.row, ...target.patch, user_id: attacker.user.id, updated_at: new Date().toISOString() };
  if (target.table === 'habit_entries') row.habit_id = attackerFixtures.habit.id;
  if (target.table === 'notes') row.folder_id = attackerFixtures.folder.id;
  if (target.table === 'focus_sessions') row.task_id = attackerFixtures.task.id;
  return row;
}
async function assertInvisible(viewer, target) {
  const rows = await expectOk(await rest(viewer, target.table, '?' + target.key + '=eq.' + target.row[target.key] + '&select=*'), 'Cross-user SELECT ' + target.table);
  assert.deepEqual(rows, [], target.table + ': another user\'s row is visible');
}
async function assertStillOwned(owner, target) {
  const rows = await expectOk(await rest(owner, target.table, '?' + target.key + '=eq.' + target.row[target.key] + '&select=*'), 'Owner re-read ' + target.table);
  assert.equal(rows.length, 1, target.table + ': owner row changed or disappeared');
  if ('user_id' in rows[0]) assert.equal(rows[0].user_id, owner.user.id, target.table + ': ownership changed');
}
async function attack(attacker, owner, ownerFixtures, attackerFixtures) {
  for (const target of targets(ownerFixtures)) {
    const filter = '?' + target.key + '=eq.' + target.row[target.key];
    await assertInvisible(attacker, target);
    const update = await rest(attacker, target.table, filter, { method: 'PATCH', body: target.patch });
    assert.equal(update.response.ok, true, target.table + ': hidden-row UPDATE errored unexpectedly');
    assert.deepEqual(update.data, [], target.table + ': cross-user UPDATE returned a row');
    await assertStillOwned(owner, target);
    const removal = await rest(attacker, target.table, filter, { method: 'DELETE' });
    assert.equal(removal.response.ok, true, target.table + ': hidden-row DELETE errored unexpectedly');
    assert.deepEqual(removal.data, [], target.table + ': cross-user DELETE returned a row');
    await assertStillOwned(owner, target);
    const upsert = await rest(attacker, target.table, '?on_conflict=' + target.key, { method: 'POST', prefer: 'return=representation,resolution=merge-duplicates', body: attackRow(target, attacker, attackerFixtures) });
    assert.equal(upsert.response.ok, false, target.table + ': cross-user UPSERT unexpectedly succeeded');
    await assertStillOwned(owner, target);
  }
  await assertInvisible(attacker, { table: 'notes', key: 'id', row: ownerFixtures.protectedNote });
}
async function assertProtectedConstraint(session, fixtures) {
  const id = randomUUID();
  const unsafe = { id, user_id: session.user.id, folder_id: fixtures.folder.id, title: 'SEVER_DB_PLAINTEXT_MARKER', body: '', kind: 'protected', items: [], done: false, protected: true, secure: fixtures.protectedNote.secure };
  const result = await rest(session, 'notes', '', { method: 'POST', body: unsafe });
  if (result.response.ok) await rest(session, 'notes', '?id=eq.' + id, { method: 'DELETE', prefer: 'return=minimal' });
  assert.equal(result.response.ok, false, 'Database accepted plaintext in a protected note');
}


async function cleanup(session, f) {
  if (!f) return;
  const rows = [['habit_entries', 'id', f.habitEntry?.id], ['notes', 'id', f.note?.id], ['notes', 'id', f.protectedNote?.id], ['focus_sessions', 'id', f.focus?.id], ['tasks', 'id', f.task?.id], ['habits', 'id', f.habit?.id], ['note_folders', 'id', f.folder?.id], ['user_settings', 'user_id', session.user.id]];
  for (const [table, key, value] of rows) if (value) await rest(session, table, '?' + key + '=eq.' + value, { method: 'DELETE', prefer: 'return=minimal' });
}

test('RLS isolates every cloud table between users A and B', {
  skip: missing.length ? 'Missing disposable-user RLS configuration: ' + missing.join(', ') : false,
  timeout: 120000
}, async () => {
  const userA = await signIn(config.emailA, config.passwordA);
  const userB = await signIn(config.emailB, config.passwordB);
  let fixturesA, fixturesB;
  try {
    fixturesA = await createFixtures(userA, 'A');
    fixturesB = await createFixtures(userB, 'B');
    await assertProtectedConstraint(userA, fixturesA);
    await assertProtectedConstraint(userB, fixturesB);
    await attack(userB, userA, fixturesA, fixturesB);
    await attack(userA, userB, fixturesB, fixturesA);
  } finally {
    await cleanup(userA, fixturesA);
    await cleanup(userB, fixturesB);
  }
});
