(function (root, factory) {
  const api = factory();
  root.SeverProtectedNotesCrypto = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const CURRENT_VERSION = 2;
  const DEFAULT_ITERATIONS = 600000;
  const MIN_ITERATIONS = 100000;
  const MAX_ITERATIONS = 5000000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const cryptoApi = () => {
    if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') throw new Error('Web Crypto API is unavailable');
    return globalThis.crypto;
  };

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  }
  function base64ToBytes(value) {
    if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4) throw new Error('Invalid base64');
    const bytes = typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(value, 'base64')) : Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if (bytesToBase64(bytes) !== value) throw new Error('Non-canonical base64');
    return bytes;
  }
  function payloadShape(payload) {
    return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.title === 'string' && typeof payload.body === 'string' && ['text', 'checklist'].includes(payload.kind) && Array.isArray(payload.items) && payload.items.every(item => item && typeof item === 'object' && typeof item.text === 'string' && typeof item.done === 'boolean') && typeof payload.done === 'boolean');
  }
  function inspectSecurePayload(secure) {
    try {
      if (!secure || typeof secure !== 'object' || Array.isArray(secure) || secure.algorithm !== 'AES-GCM') return null;
      const isV2 = secure.version === CURRENT_VERSION;
      const isV1 = secure.version === undefined || secure.version === 1;
      if (!isV1 && !isV2) return null;
      const kdf = isV2 ? secure.kdf : { name: secure.kdf === 'PBKDF2-SHA256' ? 'PBKDF2' : '', hash: 'SHA-256', iterations: secure.iterations, salt: secure.salt };
      const iterations = Number(kdf?.iterations);
      const salt = base64ToBytes(kdf?.salt);
      const iv = base64ToBytes(secure.iv);
      const cipherBytes = base64ToBytes(isV2 ? secure.ciphertext : secure.cipher);
      if (kdf?.name !== 'PBKDF2' || kdf?.hash !== 'SHA-256' || !Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS || salt.length < 16 || salt.length > 64 || iv.length !== 12 || cipherBytes.length < 17) return null;
      return { version: isV2 ? 2 : 1, iterations, salt, iv, cipherBytes };
    } catch { return null; }
  }
  async function importPasswordMaterial(password) {
    if (typeof password !== 'string' || !password) throw new Error('Password is required');
    const bytes = encoder.encode(password);
    try { return await cryptoApi().subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']); }
    finally { bytes.fill(0); password = ''; }
  }
  const deriveKey = (material, salt, iterations) => cryptoApi().subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  async function sealWithMaterial(payload, material, iterations = DEFAULT_ITERATIONS) {
    if (!payloadShape(payload)) throw new Error('Invalid protected note content');
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error('Invalid KDF cost');
    const api = cryptoApi(), salt = api.getRandomValues(new Uint8Array(16)), iv = api.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(material, salt, iterations), plaintext = encoder.encode(JSON.stringify(payload));
    try {
      const ciphertext = await api.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
      return { version: 2, algorithm: 'AES-GCM', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(salt) }, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
    } finally { plaintext.fill(0); salt.fill(0); iv.fill(0); }
  }
  async function protect(payload, password, iterations = DEFAULT_ITERATIONS) {
    const material = await importPasswordMaterial(password), secure = await sealWithMaterial(payload, material, iterations);
    return { payload, material, secure, unlockedAt: Date.now(), lastActivityAt: Date.now() };
  }
  async function unlock(secure, password) {
    const inspected = inspectSecurePayload(secure);
    if (!inspected) throw new Error('Invalid encrypted payload');
    const material = await importPasswordMaterial(password), key = await deriveKey(material, inspected.salt, inspected.iterations);
    let decrypted;
    try {
      decrypted = await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv: inspected.iv }, key, inspected.cipherBytes);
      const payload = JSON.parse(decoder.decode(decrypted));
      if (!payloadShape(payload)) throw new Error('Invalid protected note content');
      return { payload, material, version: inspected.version, unlockedAt: Date.now(), lastActivityAt: Date.now() };
    } finally { inspected.salt.fill(0); inspected.iv.fill(0); inspected.cipherBytes.fill(0); if (decrypted) new Uint8Array(decrypted).fill(0); }
  }
  return Object.freeze({ CURRENT_VERSION, DEFAULT_ITERATIONS, MIN_ITERATIONS, inspectSecurePayload, isValidSecurePayload: secure => Boolean(inspectSecurePayload(secure)), payloadShape, protect, unlock, sealWithMaterial });
});
