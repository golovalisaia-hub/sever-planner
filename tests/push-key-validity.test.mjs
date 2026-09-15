import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const files = ['sever2-task-reminders.js', 'sever2-reminder-bridge-v95.js'];
const sources = files.map(file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
const keys = sources.map(source => source.match(/VAPID_PUBLIC_KEY = '([^']+)'/)[1]);

test('both push clients use the same valid P-256 application server key', async () => {
  assert.equal(keys[0], keys[1]);
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const start = source.indexOf('  function decodePublicKey(');
    const end = source.indexOf('\n  }', start) + 4;
    const decode = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', { atob, Uint8Array });
    const bytes = decode(keys[i]);
    assert.equal(bytes.length, 65);
    assert.equal(bytes[0], 4);
    const imported = await webcrypto.subtle.importKey('raw', bytes, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    assert.equal(imported.algorithm.namedCurve, 'P-256');
  }
});

test('previous malformed point is rejected even though its length looks valid', async () => {
  const broken = Buffer.from('BGZgDkSfY_K2my7NyLzsWprVLUMKdVGH_Kd2k0DceANXmqwN4cgafdaLNvb9KOPcfFUAWHkxha9ykisXfRsVpx0', 'base64url');
  assert.equal(broken.length, 65);
  await assert.rejects(webcrypto.subtle.importKey('raw', broken, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']), { name: 'DataError' });
});

test('hotfix cache resolves stale push and guide requests to freshly versioned files', () => {
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const assets = vm.runInNewContext(sw.match(/const ASSETS = (\[[\s\S]*?\]);/)[1]);
  for (const file of [...files, 'mobile-ui.js', 'sever2-onboarding-v110.css']) {
    assert.equal(assets.find(asset => asset.split('?')[0] === './' + file), './' + file + '?v=1112');
  }
});
