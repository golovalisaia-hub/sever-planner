(function (root, factory) {
  const api = factory();
  root.SeverProtectedNotesCrypto = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const CURRENT_VERSION = 2;
  const VAULT_VERSION = 1;
  const VAULT_SECURE_VERSION = 3;
  const VAULT_SCOPE = 'notes-vault-v1';
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
  function inspectVaultPayload(secure) {
    try {
      if (!secure || typeof secure !== 'object' || Array.isArray(secure) || secure.version !== VAULT_SECURE_VERSION || secure.algorithm !== 'AES-GCM' || secure.keyScope !== VAULT_SCOPE) return null;
      const iv = base64ToBytes(secure.iv), cipherBytes = base64ToBytes(secure.ciphertext);
      if (iv.length !== 12 || cipherBytes.length < 17) return null;
      return { version: VAULT_SECURE_VERSION, iv, cipherBytes };
    } catch { return null; }
  }
  function inspectVaultDescriptor(descriptor) {
    try {
      if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor) || descriptor.version !== VAULT_VERSION || descriptor.algorithm !== 'AES-GCM' || descriptor.scope !== VAULT_SCOPE) return null;
      const iterations = Number(descriptor.kdf?.iterations), salt = base64ToBytes(descriptor.kdf?.salt), iv = base64ToBytes(descriptor.verifier?.iv), cipherBytes = base64ToBytes(descriptor.verifier?.ciphertext);
      if (descriptor.kdf?.name !== 'PBKDF2' || descriptor.kdf?.hash !== 'SHA-256' || !Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS || salt.length < 16 || salt.length > 64 || iv.length !== 12 || cipherBytes.length < 17) return null;
      return { iterations, salt, iv, cipherBytes };
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

  const vaultAad = context => encoder.encode(`SEVER:${VAULT_SCOPE}:${String(context)}`);
  async function createNotesVault(password, iterations = DEFAULT_ITERATIONS) {
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new Error('Invalid KDF cost');
    const api = cryptoApi(), salt = api.getRandomValues(new Uint8Array(16)), iv = api.getRandomValues(new Uint8Array(12));
    const material = await importPasswordMaterial(password), key = await deriveKey(material, salt, iterations), plaintext = encoder.encode('SEVER_NOTES_VAULT_OK'), aad = vaultAad('verifier');
    try {
      const ciphertext = await api.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext);
      const descriptor = { version: VAULT_VERSION, algorithm: 'AES-GCM', scope: VAULT_SCOPE, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(salt) }, verifier: { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) } };
      return { descriptor, key, unlockedAt: Date.now(), lastActivityAt: Date.now() };
    } finally { plaintext.fill(0); salt.fill(0); iv.fill(0); aad.fill(0); }
  }
  async function unlockNotesVault(descriptor, password) {
    const inspected = inspectVaultDescriptor(descriptor);
    if (!inspected) throw new Error('Invalid vault descriptor');
    const material = await importPasswordMaterial(password), key = await deriveKey(material, inspected.salt, inspected.iterations), aad = vaultAad('verifier');
    let decrypted;
    try {
      decrypted = await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv: inspected.iv, additionalData: aad }, key, inspected.cipherBytes);
      if (decoder.decode(decrypted) !== 'SEVER_NOTES_VAULT_OK') throw new Error('Invalid vault password');
      return { key, unlockedAt: Date.now(), lastActivityAt: Date.now() };
    } finally { inspected.salt.fill(0); inspected.iv.fill(0); inspected.cipherBytes.fill(0); aad.fill(0); if (decrypted) new Uint8Array(decrypted).fill(0); }
  }
  async function sealVaultPayload(payload, key, noteId) {
    if (!payloadShape(payload)) throw new Error('Invalid protected note content');
    if (!key || !noteId) throw new Error('Vault key is unavailable');
    const api = cryptoApi(), iv = api.getRandomValues(new Uint8Array(12)), plaintext = encoder.encode(JSON.stringify(payload)), aad = vaultAad(`note:${noteId}`);
    try {
      const ciphertext = await api.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext);
      return { version: VAULT_SECURE_VERSION, algorithm: 'AES-GCM', keyScope: VAULT_SCOPE, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
    } finally { plaintext.fill(0); iv.fill(0); aad.fill(0); }
  }
  async function unlockVaultPayload(secure, key, noteId) {
    const inspected = inspectVaultPayload(secure);
    if (!inspected || !key || !noteId) throw new Error('Invalid vault payload');
    const aad = vaultAad(`note:${noteId}`); let decrypted;
    try {
      decrypted = await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv: inspected.iv, additionalData: aad }, key, inspected.cipherBytes);
      const payload = JSON.parse(decoder.decode(decrypted));
      if (!payloadShape(payload)) throw new Error('Invalid protected note content');
      return payload;
    } finally { inspected.iv.fill(0); inspected.cipherBytes.fill(0); aad.fill(0); if (decrypted) new Uint8Array(decrypted).fill(0); }
  }
  async function sealVaultText(text, key, context) {
    if (typeof text !== 'string' || !key || !context) throw new Error('Invalid vault text');
    const api = cryptoApi(), iv = api.getRandomValues(new Uint8Array(12)), plaintext = encoder.encode(text), aad = vaultAad(`text:${context}`);
    try {
      const ciphertext = await api.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext);
      return `svault1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
    } finally { plaintext.fill(0); iv.fill(0); aad.fill(0); }
  }
  async function unlockVaultText(value, key, context) {
    if (typeof value !== 'string' || !value.startsWith('svault1:') || !key || !context) throw new Error('Invalid vault text');
    const parts = value.split(':'); if (parts.length !== 3) throw new Error('Invalid vault text');
    const iv = base64ToBytes(parts[1]), cipherBytes = base64ToBytes(parts[2]), aad = vaultAad(`text:${context}`); let decrypted;
    if (iv.length !== 12 || cipherBytes.length < 17) throw new Error('Invalid vault text');
    try {
      decrypted = await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, cipherBytes);
      return decoder.decode(decrypted);
    } finally { iv.fill(0); cipherBytes.fill(0); aad.fill(0); if (decrypted) new Uint8Array(decrypted).fill(0); }
  }
  const isVaultPayload = secure => Boolean(inspectVaultPayload(secure));
  const isValidSecurePayload = secure => Boolean(inspectSecurePayload(secure) || inspectVaultPayload(secure));
  return Object.freeze({ CURRENT_VERSION, VAULT_VERSION, VAULT_SECURE_VERSION, VAULT_SCOPE, DEFAULT_ITERATIONS, MIN_ITERATIONS, inspectSecurePayload, inspectVaultPayload, inspectVaultDescriptor, isValidSecurePayload, isVaultPayload, payloadShape, protect, unlock, sealWithMaterial, createNotesVault, unlockNotesVault, sealVaultPayload, unlockVaultPayload, sealVaultText, unlockVaultText });
});
