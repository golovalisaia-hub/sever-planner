import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const auth = fs.readFileSync('sever2-email-otp-auth-v111-1.js', 'utf8');
const bootstrap = fs.readFileSync('sever2-notes-org-repair-v95.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

test('v111.1 passwordless auth layer is syntax-valid and sends email OTP', () => {
  assert.doesNotThrow(() => new vm.Script(auth));
  assert.match(auth, /auth\.signInWithOtp\(\{/);
  assert.match(auth, /shouldCreateUser:\s*true/);
  assert.match(auth, /auth\.verifyOtp\(\{\s*email:\s*requestedEmail,\s*token,\s*type:\s*'email'\s*\}\)/);
  assert.ok(auth.includes('autocomplete="one-time-code"'));
  assert.ok(auth.includes('pattern="[0-9]{6}"'));
  assert.match(auth, /RESEND_SECONDS\s*=\s*60/);
});

test('v111.1 removes account password and registration choices from the visible flow', () => {
  assert.match(auth, /password\.required\s*=\s*false/);
  assert.match(auth, /password\.closest\('label'\)\?\.classList\.add\('hidden'\)/);
  assert.match(auth, /mode\.classList\.add\('hidden'\)/);
  assert.match(auth, /submit\.textContent\s*=\s*'Получить код'/);
  assert.match(auth, /event\.stopImmediatePropagation\(\)/);
});

test('v111.1 keeps account identity on the existing authenticated UUID path', () => {
  assert.match(auth, /await cloud\.applySession\(user\)/);
  assert.doesNotMatch(auth, /profiles[^\n]*email[^\n]*owner/i);
  assert.doesNotMatch(auth, /user_metadata[^\n]*(owner|role)/i);
});

test('v111.1 OTP layer is loaded and cached atomically for installed PWAs', () => {
  assert.match(bootstrap, /sever2-email-otp-auth-v111-1\.css\?v=1111/);
  assert.match(bootstrap, /sever2-email-otp-auth-v111-1\.js\?v=1111/);
  assert.match(sw, /sever-v111-email-otp-auth-release-v1/);
  assert.match(sw, /sever2-email-otp-auth-v111-1\.css\?v=1111/);
  assert.match(sw, /sever2-email-otp-auth-v111-1\.js\?v=1111/);
  assert.match(sw, /sever2-notes-org-repair-v95\.js\?v=1111/);
});
