const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
globalThis.crypto = webcrypto;
require('../../js/protected-notes-crypto.js');
const security = require('../../js/security-core.js');

const markerTitle = 'SEVER_SECRET_TITLE_8ad72', markerBody = 'SEVER_SECRET_BODY_91bb2';
async function state() {
  const payload = { title: markerTitle, body: markerBody, kind: 'text', items: [], done: false };
  const { secure } = await globalThis.SeverProtectedNotesCrypto.protect(payload, 'correct horse battery staple', 100000);
  return { version: 10, tasks: [], habits: [], notes: [{ id: 'note-1', folderId: '', title: '', body: '', kind: 'protected', items: [], done: false, protected: true, secure }], folders: [], focusSessions: [] };
}
test('localStorage, IndexedDB projection and backup contain ciphertext only', async () => {
  const source = await state(), persistent = security.persistentState(source), backup = security.createBackup(source), vault = security.createVaultExport(source);
  for (const serialized of [JSON.stringify(persistent), JSON.stringify(structuredClone(persistent)), JSON.stringify(backup), JSON.stringify(vault)]) {
    assert.equal(serialized.includes(markerTitle), false); assert.equal(serialized.includes(markerBody), false);
  }
  assert.equal(backup.format, 'sever-backup'); assert.equal(backup.version, 2);
  assert.equal(vault.format, 'sever-vault'); assert.equal(vault.notes.length, 1);
});
test('plaintext protected note is rejected before persistence/export/sync', async () => {
  const source = await state(); source.notes[0].title = markerTitle;
  assert.throws(() => security.persistentState(source));
  assert.throws(() => security.createBackup(source));
  assert.throws(() => security.assertCloudOperation({ collection: 'notes', record: source.notes[0] }));
});
test('backup parser accepts v2 and safe legacy, rejects malformed encrypted payload and pollution keys', async () => {
  const source = await state();
  assert.equal(security.parseBackupText(JSON.stringify(security.createBackup(source))).notes.length, 1);
  assert.equal(security.parseBackupText(JSON.stringify(source)).notes.length, 1);
  const malformed = security.createBackup(source); malformed.data.notes[0].secure.iv = 'not-base64';
  assert.throws(() => security.parseBackupText(JSON.stringify(malformed)));
  assert.throws(() => security.parseBackupText('{"format":"sever-backup","version":2,"data":{"tasks":[],"notes":[],"habits":[],"__proto__":{"polluted":true}}}'));
});
