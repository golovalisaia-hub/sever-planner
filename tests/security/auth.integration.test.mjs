import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..', '..');
const sdkSource = fs.readFileSync(path.join(root, 'vendor', 'supabase.min.js'), 'utf8');
const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const bundledSupabase = require(path.join(root, 'vendor', 'supabase.min.js'));

test('bundled Supabase SDK exposes createClient', () => {
  assert.match(sdkSource, /@supabase\/supabase-js@2\.57\.4/);
  assert.equal(typeof bundledSupabase.createClient, 'function');
});

const config = {
  url: process.env.SEVER_AUTH_TEST_URL?.replace(/\/$/, ''),
  anonKey: process.env.SEVER_AUTH_TEST_ANON_KEY,
  email: process.env.SEVER_AUTH_TEST_EMAIL,
  password: process.env.SEVER_AUTH_TEST_PASSWORD
};
const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);

test('disposable account can sign in, restore, refresh and sign out', {
  skip: missing.length ? 'Missing disposable-user Auth configuration: ' + missing.join(', ') : false,
  timeout: 120000
}, async () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const client = bundledSupabase.createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage }
  });

  const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email: config.email, password: config.password });
  assert.equal(signInError, null, 'Disposable account sign-in failed: ' + signInError?.message);
  assert.ok(signedIn.session?.access_token && signedIn.session?.refresh_token && signedIn.user?.id, 'signInWithPassword returned no complete session');

  const { data: restored, error: restoreError } = await client.auth.getSession();
  assert.equal(restoreError, null, 'getSession failed: ' + restoreError?.message);
  assert.equal(restored.session?.user?.id, signedIn.user.id, 'getSession did not restore the signed-in user');

  const { data: refreshed, error: refreshError } = await client.auth.refreshSession();
  assert.equal(refreshError, null, 'refreshSession failed: ' + refreshError?.message);
  assert.equal(refreshed.user?.id, signedIn.user.id, 'refreshSession changed the signed-in user');

  const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
  assert.equal(signOutError, null, 'signOut failed: ' + signOutError?.message);
  const { data: signedOut } = await client.auth.getSession();
  assert.equal(signedOut.session, null, 'Session remained available after signOut');
});
