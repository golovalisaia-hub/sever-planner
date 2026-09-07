import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('v44 service worker installs AI assets atomically and removes stale caches', async () => {
  const handlers = new Map();
  const deleted = [];
  let cachedAssets = [];
  let claimed = false;
  let skipped = false;
  const self = {
    location: { origin: 'https://example.test' },
    clients: { claim: async () => { claimed = true; } },
    skipWaiting: () => { skipped = true; },
    addEventListener: (type, handler) => handlers.set(type, handler)
  };
  const caches = {
    open: async name => ({ addAll: async assets => { assert.equal(name, 'sever-v44-ai-r1'); cachedAssets = assets; }, put: async () => {} }),
    keys: async () => ['sever-v35', 'sever-v36-security', 'sever-v37-auth', 'sever-v38-brand', 'sever-v39-northern', 'sever-v40-northern', 'sever-v41-global-rebuild', 'sever-v41-global-rebuild-r2', 'sever-v42-sync-calendar-r1', 'sever-v43-sync-audit-r1'],
    delete: async name => { deleted.push(name); return true; },
    match: async () => null
  };
  vm.runInNewContext(source, { self, caches, clients: self.clients, fetch: async () => ({ clone() { return this; } }), URL, Promise });

  let installWork;
  handlers.get('install')({ waitUntil: promise => { installWork = promise; } });
  await installWork;
  assert.ok(cachedAssets.includes('./index.html'));
  assert.ok(cachedAssets.includes('./js/cloud-runtime.js?v=43'));
  assert.ok(cachedAssets.includes('./sever-v41.css?v=43'));
  assert.ok(cachedAssets.includes('./reference-theme.css?v=43'));
  assert.ok(cachedAssets.includes('./sever-ai.css?v=44'));
  assert.ok(cachedAssets.includes('./js/sever-ai.js?v=44'));
  assert.ok(cachedAssets.includes('./aurora.webp'));
  assert.ok(cachedAssets.includes('./assets/sever/mountain-night.svg'));

  let activateWork;
  handlers.get('activate')({ waitUntil: promise => { activateWork = promise; } });
  await activateWork;
  assert.deepEqual(deleted.sort(), ['sever-v35', 'sever-v36-security', 'sever-v37-auth', 'sever-v38-brand', 'sever-v39-northern', 'sever-v40-northern', 'sever-v41-global-rebuild', 'sever-v41-global-rebuild-r2', 'sever-v42-sync-calendar-r1', 'sever-v43-sync-audit-r1']);
  assert.equal(claimed, true);

  handlers.get('message')({ data: { type: 'SKIP_WAITING' } });
  assert.equal(skipped, true);
});
