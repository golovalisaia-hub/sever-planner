import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ECDH } from 'node:crypto';

// Public value read from this project's Vault; never store the private key here.
const deployedPublicKey = 'BJebqzKOHHkvVsoNnlt4tJpVcvYWFyI93tcLQgO2JJZyDkQ66UsKscOTZsV9NFqqviSZY26lGapm3S7gCV4GsMM';
for (const file of ['sever2-task-reminders.js', 'sever2-reminder-bridge-v95.js', 'sever2-ios-push-corefix-v1111.js']) {
  test(`${file} uses the server public key and a valid P-256 point`, () => {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const key = source.match(/const VAPID_PUBLIC_KEY = '([^']+)'/)?.[1];
    assert.equal(key, deployedPublicKey);
    const bytes = Buffer.from(key, 'base64url');
    assert.equal(bytes.length, 65);
    assert.equal(bytes[0], 4);
    assert.deepEqual(ECDH.convertKey(bytes, 'prime256v1'), bytes);
  });
}

test('the former 65-byte key is rejected despite its correct length', () => {
  const bytes = Buffer.from('BGZgDkSfY_K2my7NyLzsWprVLUMKdVGH_Kd2k0DceANXmqwN4cgafdaLNvb9KOPcfFUAWHkxha9ykisXfRsVpx0', 'base64url');
  assert.equal(bytes.length, 65);
  assert.throws(() => ECDH.convertKey(bytes, 'prime256v1'));
});
