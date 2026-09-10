import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const RELEASE_CACHE = 'sever-v61-focus-flow-v2';

test('v61 service worker installs the focus flow release atomically and removes stale caches', async () => {
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
    open: async name => ({ addAll: async assets => { assert.equal(name, RELEASE_CACHE); cachedAssets = assets; }, put: async () => {} }),
    keys: async () => ['sever-v35', 'sever-v59-productivity-v2', 'sever-v60-focus-inbox-v1'],
    delete: async name => { deleted.push(name); return true; },
    match: async () => null
  };
  vm.runInNewContext(source, { self, caches, clients: self.clients, fetch: async () => ({ clone() { return this; } }), URL, Promise });

  let installWork;
  handlers.get('install')({ waitUntil: promise => { installWork = promise; } });
  await installWork;
  assert.ok(cachedAssets.includes('./index.html'));
  assert.ok(cachedAssets.includes('./js/cloud-runtime.js?v=55'));
  assert.ok(cachedAssets.includes('./app.js?v=51'));
  assert.ok(cachedAssets.includes('./mobile-home.css?v=52'));
  assert.ok(cachedAssets.includes('./desktop-system.css?v=60'));
  assert.ok(!cachedAssets.includes('./desktop-home.css?v=60'));
  assert.ok(cachedAssets.includes('./themes.css?v=60'));
  assert.ok(cachedAssets.includes('./sever2-ui.css?v=61'));
  assert.ok(cachedAssets.includes('./sever2-qa.css?v=61'));
  assert.ok(cachedAssets.includes('./sever2-productivity.css?v=64'));
  assert.ok(cachedAssets.includes('./sever2-productivity.js?v=64'));
  assert.ok(cachedAssets.includes('./sever2-focus-flow.css?v=65'));
  assert.ok(cachedAssets.includes('./sever2-focus-flow.js?v=65'));
  assert.ok(cachedAssets.includes('./js/theme-init.js?v=65'));
  assert.ok(cachedAssets.includes('./sever-ai.css?v=52'));
  assert.ok(cachedAssets.includes('./js/sever-ai.js?v=45'));
  assert.ok(!cachedAssets.includes('./aurora.webp'));
  assert.ok(!cachedAssets.includes('./assets/sever/mountain-night.svg'));

  let activateWork;
  handlers.get('activate')({ waitUntil: promise => { activateWork = promise; } });
  await activateWork;
  assert.ok(deleted.includes('sever-v60-focus-inbox-v1'));
  assert.ok(!deleted.includes(RELEASE_CACHE));
  assert.equal(claimed, true);
  assert.equal(skipped, true);

  handlers.get('message')({ data: { type: 'SKIP_WAITING' } });
  assert.equal(skipped, true);
});

test('installed release serves HTML and critical focus assets from one release cache', async () => {
  const handlers = new Map(), requests = [];
  let network = 0;
  const self = { location: { origin: 'https://example.test' }, registration: { scope: 'https://example.test/sever-planner/' }, addEventListener: (name, fn) => handlers.set(name, fn) };
  const caches = { open: async name => { assert.equal(name, RELEASE_CACHE); return { match: async key => { requests.push(key); return { release: 61, key }; } }; } };
  vm.runInNewContext(source, { self, caches, URL, Response, fetch: async () => { network++; throw Error('network must not update a release'); } });
  for (const [pathValue, mode, expected] of [
    ['?verify=new','navigate','./index.html'],
    ['mobile-home.css?v=old','cors','./mobile-home.css?v=52'],
    ['desktop-system.css?v=old','cors','./desktop-system.css?v=60'],
    ['themes.css?v=old','cors','./themes.css?v=60'],
    ['sever2-ui.css?v=old','cors','./sever2-ui.css?v=61'],
    ['sever2-qa.css?v=old','cors','./sever2-qa.css?v=61'],
    ['sever2-productivity.css?v=old','cors','./sever2-productivity.css?v=64'],
    ['sever2-productivity.js?v=old','cors','./sever2-productivity.js?v=64'],
    ['sever2-focus-flow.css?v=old','cors','./sever2-focus-flow.css?v=65'],
    ['sever2-focus-flow.js?v=old','cors','./sever2-focus-flow.js?v=65'],
    ['js/theme-init.js?v=old','cors','./js/theme-init.js?v=65'],
    ['app.js?v=new','cors','./app.js?v=51']
  ]) {
    let response;
    handlers.get('fetch')({ request: { method: 'GET', url: 'https://example.test/sever-planner/'+pathValue, mode }, respondWith: promise => { response = promise; } });
    assert.equal((await response).key, expected);
  }
  assert.equal(network, 0);
  assert.equal(requests.length, 12);
});
