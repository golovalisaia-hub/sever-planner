import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('v51 service worker installs mobile home assets atomically and removes stale caches', async () => {
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
    open: async name => ({ addAll: async assets => { assert.equal(name, 'sever-v53-multi-theme'); cachedAssets = assets; }, put: async () => {} }),
    keys: async () => ['sever-v35', 'sever-v36-security', 'sever-v37-auth', 'sever-v38-brand', 'sever-v39-northern', 'sever-v40-northern', 'sever-v41-global-rebuild', 'sever-v41-global-rebuild-r2', 'sever-v42-sync-calendar-r1', 'sever-v43-sync-audit-r1'],
    delete: async name => { deleted.push(name); return true; },
    match: async () => null
  };
  vm.runInNewContext(source, { self, caches, clients: self.clients, fetch: async () => ({ clone() { return this; } }), URL, Promise });

  let installWork;
  handlers.get('install')({ waitUntil: promise => { installWork = promise; } });
  await installWork;
  assert.ok(cachedAssets.includes('./index.html'));
  assert.ok(cachedAssets.includes('./js/cloud-runtime.js?v=47'));
  assert.ok(cachedAssets.includes('./app.js?v=53'));
  assert.ok(cachedAssets.includes('./themes.css?v=53'));
  assert.ok(cachedAssets.includes('./js/theme-init.js?v=53'));
  assert.ok(cachedAssets.includes('./northern-components.css?v=48'));
  assert.ok(cachedAssets.includes('./mobile-home.css?v=52'));
  assert.ok(cachedAssets.includes('./sever-v41.css?v=52'));
  assert.ok(cachedAssets.includes('./reference-theme.css?v=43'));
  assert.ok(cachedAssets.includes('./sever-ai.css?v=52'));
  assert.ok(cachedAssets.includes('./js/sever-ai.js?v=45'));
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

test('installed release serves HTML and critical assets from the same cache even online', async () => {
  const handlers = new Map(), requests = [];
  let network = 0;
  const self = { location: { origin: 'https://example.test' }, registration: { scope: 'https://example.test/sever-planner/' }, addEventListener: (name, fn) => handlers.set(name, fn) };
  const caches = { open: async name => { assert.equal(name, 'sever-v53-multi-theme'); return { match: async key => { requests.push(key); return { release: 51, key }; } }; } };
  vm.runInNewContext(source, { self, caches, URL, Response, fetch: async () => { network++; throw Error('network must not update a release'); } });
  for (const [path, mode, expected] of [['?verify=new','navigate','./index.html'],['mobile-home.css?v=old','cors','./mobile-home.css?v=52'],['app.js?v=new','cors','./app.js?v=53']]) {
    let response;
    handlers.get('fetch')({ request: { method: 'GET', url: 'https://example.test/sever-planner/'+path, mode }, respondWith: promise => { response = promise; } });
    assert.equal((await response).key, expected);
  }
  assert.equal(network, 0);
  assert.equal(requests.length, 3);
});
