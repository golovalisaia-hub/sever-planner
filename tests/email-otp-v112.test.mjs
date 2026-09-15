import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const otp = fs.readFileSync(new URL('../sever2-email-otp-v112.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../sever2-email-otp-v112.css', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../js/supabase-client.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('v112 passwordless auth layer parses and uses the Supabase email OTP contract', () => {
  assert.doesNotThrow(() => new vm.Script(otp));
  assert.match(otp, /auth\.signInWithOtp\(\{/);
  assert.match(otp, /shouldCreateUser:\s*true/);
  assert.match(otp, /auth\.verifyOtp\(\{/);
  assert.match(otp, /token:\s*code/);
  assert.match(otp, /type:\s*'email'/);
  assert.match(otp, /\^\\d\{6\}\$/);
  assert.doesNotMatch(otp, /signInWithPassword/);
  assert.doesNotMatch(otp, /signUp\(/);
});

test('v112 keeps persistent UUID-scoped sessions and retires password UI from the normal account flow', () => {
  assert.match(client, /persistSession:\s*true/);
  assert.match(client, /sever2-email-otp-v112\.js\?v=112/);
  assert.match(client, /sever2-email-otp-v112\.css\?v=112/);
  assert.match(otp, /#accountPassword/);
  assert.match(otp, /password\.required\s*=\s*false/);
  assert.match(otp, /#accountMode/);
  assert.match(otp, /classList\.add\('hidden'\)/);
  assert.match(css, /#severOtpCode/);
  assert.match(css, /min-height:\s*56px/);
});

test('v112 ships the passwordless layer atomically in the installed PWA', () => {
  assert.match(sw, /const CACHE = 'sever-v112-email-otp-release-v1'/);
  assert.match(sw, /\.\/sever2-email-otp-v112\.css\?v=112/);
  assert.match(sw, /\.\/sever2-email-otp-v112\.js\?v=112/);
  assert.match(sw, /\.\/js\/supabase-client\.js\?v=112/);
  assert.match(sw, /'\/sever2-email-otp-v112\.css'/);
  assert.match(sw, /'\/sever2-email-otp-v112\.js'/);
});
