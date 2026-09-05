const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
globalThis.crypto = webcrypto;
const cryptoCore = require('../../js/protected-notes-crypto.js');

const payload = { title: 'SEVER_SECRET_TITLE_8ad72', body: 'SEVER_SECRET_BODY_91bb2', kind: 'checklist', items: [{ text: 'secret item', done: false }], done: false };

test('v2 encrypt/decrypt round trip and no plaintext envelope', async () => {
  const sealed = await cryptoCore.protect(payload, 'correct horse battery staple', 100000);
  assert.equal(sealed.secure.version, 2);
  assert.equal(JSON.stringify(sealed.secure).includes('SEVER_SECRET'), false);
  assert.deepEqual((await cryptoCore.unlock(sealed.secure, 'correct horse battery staple')).payload, payload);
});

test('wrong password and tampering fail closed', async () => {
  const { secure } = await cryptoCore.protect(payload, 'correct horse battery staple', 100000);
  await assert.rejects(() => cryptoCore.unlock(secure, 'wrong password'));
  const badCipher = structuredClone(secure); badCipher.ciphertext = badCipher.ciphertext.replace(/^./, badCipher.ciphertext[0] === 'A' ? 'B' : 'A');
  await assert.rejects(() => cryptoCore.unlock(badCipher, 'correct horse battery staple'));
  const badIv = structuredClone(secure); badIv.iv = badIv.iv.replace(/^./, badIv.iv[0] === 'A' ? 'B' : 'A');
  await assert.rejects(() => cryptoCore.unlock(badIv, 'correct horse battery staple'));
});

test('1000 encryptions use unique salts and IVs', { timeout: 120000 }, async () => {
  const original = cryptoCore.protect;
  const material = (await original(payload, 'unique-envelopes', 100000)).material;
  const salts = new Set(), ivs = new Set();
  for (let index = 0; index < 1000; index++) {
    const secure = await cryptoCore.sealWithMaterial(payload, material, 100000);
    salts.add(secure.kdf.salt); ivs.add(secure.iv);
  }
  assert.equal(salts.size, 1000); assert.equal(ivs.size, 1000);
});

test('legacy v1 payload remains decryptable', async () => {
  const password = 'legacy password', salt = webcrypto.getRandomValues(new Uint8Array(16)), iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder(), material = await webcrypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const cipher = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
  const b64 = bytes => Buffer.from(bytes).toString('base64');
  const legacy = { algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations: 100000, salt: b64(salt), iv: b64(iv), cipher: b64(new Uint8Array(cipher)) };
  assert.equal((await cryptoCore.unlock(legacy, password)).payload.title, payload.title);
});
