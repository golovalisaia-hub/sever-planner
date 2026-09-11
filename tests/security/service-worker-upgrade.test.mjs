import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const RELEASE_CACHE = 'sever-v82-reminders-desktop-v7';

test('current service worker installs the guarded release atomically and removes stale caches', async () => {
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
    open: async name => ({ addAll: async assets => { assert.equal(name, RELEASE_CACHE); cachedAssets = assets; } }),
    keys: async () => ['sever-v75-notes-compact-v1', 'sever-v82-reminders-desktop-v6'],
    delete: async name => { deleted.push(name); return true; }
  };
  vm.runInNewContext(source, { self, caches, clients: self.clients, fetch: async () => ({}), URL, Promise, Response });
  let work;
  handlers.get('install')({ waitUntil: promise => { work = promise; } });
  await work;
  for (const asset of [
    './index.html','./sever2-home-core.css?v=85','./sever2-home-core.js?v=85','./sever2-notes-core.js?v=71','./sever2-notes-organization.js?v=72',
    './sever2-notes-editor-flow.js?v=73','./sever2-notes-navigation.css?v=74',
    './sever2-notes-navigation.js?v=74','./sever2-notes-polish.css?v=79',
    './sever2-notes-polish.js?v=79','./sever2-mobile-consistency.css?v=76',
    './sever2-money.css?v=83','./sever2-money.js?v=83',
    './sever2-usability-v84.css?v=84','./sever2-usability-v84.js?v=84',
    './sever2-interaction-polish.css?v=78','./sever2-interaction-polish.js?v=78',
    './sever2-cloud-recovery.css?v=80','./sever2-cloud-recovery.js?v=80','./js/theme-init.js?v=85'
  ]) assert.ok(cachedAssets.includes(asset), `missing ${asset}`);
  let activateWork;
  handlers.get('activate')({ waitUntil: promise => { activateWork = promise; } });
  await activateWork;
  assert.ok(deleted.includes('sever-v75-notes-compact-v1'));
  assert.ok(deleted.includes('sever-v82-reminders-desktop-v6'));
  assert.ok(!deleted.includes(RELEASE_CACHE));
  assert.equal(claimed, true);
  assert.equal(skipped, true);
});

test('installed current release serves Home v85 and recovery from one release cache', async () => {
  const handlers = new Map();
  const requests = [];
  let network = 0;
  const self = {
    location: { origin: 'https://example.test' },
    registration: { scope: 'https://example.test/sever-planner/' },
    addEventListener: (name, fn) => handlers.set(name, fn)
  };
  const caches = {
    open: async name => {
      assert.equal(name, RELEASE_CACHE);
      return { match: async key => { requests.push(key); return { release: 85, key }; } };
    }
  };
  vm.runInNewContext(source, { self, caches, URL, Response, fetch: async () => { network++; throw Error('network must not update a release'); } });
  const cases = [
    ['?verify=new','navigate','./index.html'],
    ['sever2-home-core.css?v=old','cors','./sever2-home-core.css?v=85'],
    ['sever2-home-core.js?v=old','cors','./sever2-home-core.js?v=85'],
    ['sever2-notes-core.js?v=old','cors','./sever2-notes-core.js?v=71'],
    ['sever2-notes-organization.js?v=old','cors','./sever2-notes-organization.js?v=72'],
    ['sever2-notes-editor-flow.js?v=old','cors','./sever2-notes-editor-flow.js?v=73'],
    ['sever2-notes-navigation.css?v=old','cors','./sever2-notes-navigation.css?v=74'],
    ['sever2-notes-navigation.js?v=old','cors','./sever2-notes-navigation.js?v=74'],
    ['sever2-notes-polish.css?v=old','cors','./sever2-notes-polish.css?v=79'],
    ['sever2-notes-polish.js?v=old','cors','./sever2-notes-polish.js?v=79'],
    ['sever2-mobile-consistency.css?v=old','cors','./sever2-mobile-consistency.css?v=76'],
    ['sever2-money.css?v=old','cors','./sever2-money.css?v=83'],
    ['sever2-money.js?v=old','cors','./sever2-money.js?v=83'],
    ['sever2-usability-v84.css?v=old','cors','./sever2-usability-v84.css?v=84'],
    ['sever2-usability-v84.js?v=old','cors','./sever2-usability-v84.js?v=84'],
    ['sever2-interaction-polish.css?v=old','cors','./sever2-interaction-polish.css?v=78'],
    ['sever2-interaction-polish.js?v=old','cors','./sever2-interaction-polish.js?v=78'],
    ['sever2-cloud-recovery.css?v=old','cors','./sever2-cloud-recovery.css?v=80'],
    ['sever2-cloud-recovery.js?v=old','cors','./sever2-cloud-recovery.js?v=80'],
    ['js/theme-init.js?v=old','cors','./js/theme-init.js?v=85'],
    ['app.js?v=new','cors','./app.js?v=51']
  ];
  for (const [pathValue, mode, expected] of cases) {
    let response;
    handlers.get('fetch')({ request: { method: 'GET', url: 'https://example.test/sever-planner/'+pathValue, mode }, respondWith: promise => { response = promise; } });
    assert.equal((await response).key, expected);
  }
  assert.equal(network, 0);
  assert.equal(requests.length, cases.length);
});