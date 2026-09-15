import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const otp = fs.readFileSync('sever2-email-otp-v112.js', 'utf8');
const otpCss = fs.readFileSync('sever2-email-otp-v112.css', 'utf8');
const bootstrap = fs.readFileSync('js/supabase-client.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const aiMigration = fs.readFileSync('supabase/migrations/003_sever_ai.sql', 'utf8');

test('v112 passwordless auth pack is syntax-valid and uses email OTP APIs only', () => {
  assert.doesNotThrow(() => new Function(otp));
  assert.match(otp, /auth\.signInWithOtp\(\{/);
  assert.match(otp, /shouldCreateUser:\s*true/);
  assert.match(otp, /auth\.verifyOtp\(\{\s*email,\s*token,\s*type:\s*'email'/s);
  assert.match(otp, /applySession\?\.\(user\)/);
  assert.doesNotMatch(otp, /signInWithPassword|auth\.signUp|current-password|new-password/);
});

test('v112 login UX is two-step, code-friendly and rate-limit aware', () => {
  assert.match(otp, /phase\s*=\s*'email'/);
  assert.match(otp, /phase\s*=\s*'code'/);
  assert.match(otp, /autocomplete\s*=\s*'one-time-code'/);
  assert.match(otp, /RESEND_SECONDS\s*=\s*60/);
  assert.match(otp, /sessionStorage\.setItem\(RESEND_KEY/);
  assert.match(otp, /Код истёк/);
  assert.match(otp, /Код неверный/);
  assert.match(otp, /Слишком много попыток/);
  assert.match(otpCss, /account-otp-code/);
});

test('v112 Supabase bootstrap loads passwordless UI and keeps persistent sessions', () => {
  assert.match(bootstrap, /persistSession:\s*true/);
  assert.match(bootstrap, /autoRefreshToken:\s*true/);
  assert.match(bootstrap, /sever2-email-otp-v112\.css\?v=112/);
  assert.match(bootstrap, /sever2-email-otp-v112\.js\?v=112/);
});

test('v112 PWA atomically refreshes the auth bootstrap and OTP pack', () => {
  assert.match(sw, /const CACHE = 'sever-v112-email-otp-release-v1'/);
  assert.match(sw, /sever2-email-otp-v112\.css\?v=112/);
  assert.match(sw, /sever2-email-otp-v112\.js\?v=112/);
  assert.match(sw, /js\/supabase-client\.js\?v=112/);
  assert.match(sw, /'\/sever2-email-otp-v112\.js'/);
});

test('OWNER authorization stays bound to authenticated UUID, never editable email metadata', () => {
  assert.match(aiMigration, /select role='owner' into owner from public\.profiles where id=caller/);
  assert.match(aiMigration, /revoke insert, update, delete on public\.profiles from anon, authenticated/);
  assert.match(aiMigration, /using \(id = auth\.uid\(\)\)/);
  assert.doesNotMatch(aiMigration, /raw_user_meta_data|user_metadata/);
});
