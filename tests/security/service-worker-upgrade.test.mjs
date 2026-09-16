import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const RELEASE_CACHE = source.match(/const CACHE = '([^']+)'/)?.[1] || '';
assert.ok(RELEASE_CACHE.startsWith('sever-v111-'), 'security suite must run against the v111 atomic release');

test('current service worker installs the guarded v111 release assets atomically and removes stale caches', async () => {
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
    keys: async () => [
      'sever-v82-reminders-desktop-v9','sever-v92-unified-release-v1','sever-v93-complete-release-v1','sever-v94-experience-release-v1',
      'sever-v101-reliability-release-v1','sever-v102-desktop-polish-release-v1','sever-v106-missed-tasks-release-v1',
      'sever-v107-instant-response-release-v1','sever-v108-observer-batching-release-v1','sever-v109-progress-habits-release-v1',
      'sever-v110-first-run-onboarding-release-v1',RELEASE_CACHE
    ],
    delete: async name => { deleted.push(name); return true; }
  };
  vm.runInNewContext(source, { self, caches, clients: self.clients, fetch: async () => ({}), URL, Promise, Response });
  let work;
  handlers.get('install')({ waitUntil: promise => { work = promise; } });
  await work;
  for (const asset of [
    './index.html','./sever2-efficiency.css?v=102','./sever2-home-core.css?v=85','./sever2-home-core.js?v=85','./sever2-notes-core.js?v=71','./sever2-notes-organization.js?v=72',
    './sever2-notes-editor-flow.css?v=90','./sever2-notes-editor-flow.js?v=73','./sever2-notes-navigation.css?v=74','./sever2-notes-navigation.js?v=74',
    './sever2-notes-polish.css?v=92','./sever2-notes-polish.js?v=104','./sever2-notes-responsiveness-v104.js?v=104','./sever2-mobile-consistency.css?v=76',
    './sever2-notes-compact-v87.css?v=87','./sever2-notes-compact-v87.js?v=87','./sever2-experience-v94.css?v=101','./sever2-experience-v94.js?v=101',
    './sever2-money.css?v=83','./sever2-money.js?v=83','./sever2-finance-v111.css?v=111','./sever2-finance-v111.js?v=111',
    './sever2-usability-v84.css?v=93','./sever2-usability-v84.js?v=84','./sever2-interaction-polish.css?v=103','./sever2-missed-tasks-v106.css?v=106',
    './sever2-interaction-polish.js?v=109','./sever2-progress-habits-v109.css?v=109','./sever2-progress-habits-v109.js?v=109','./sever2-onboarding-v110.css?v=110',
    './sever2-onboarding-v110.js?v=110','./sever2-notes-org-repair-v95.js?v=111','./sever2-reminders.css?v=86','./sever2-task-reminders.js?v=115','./sever2-task-reminders.js?v=114','./sever2-task-reminders.js?v=82',
    './sever2-cloud-recovery.css?v=80','./sever2-cloud-recovery.js?v=80','./app.js?v=106','./js/theme-init.js?v=92','./js/sever-ai.js?v=100'
  ]) assert.ok(cachedAssets.includes(asset), `missing ${asset}`);
  assert.ok(!cachedAssets.includes('./app.js?v=51'));
  assert.ok(!cachedAssets.includes('./sever2-efficiency.css?v=67'));
  assert.ok(!cachedAssets.includes('./sever2-experience-v94.css?v=94'));
  assert.ok(!cachedAssets.includes('./sever2-experience-v94.js?v=99'));
  assert.ok(!cachedAssets.includes('./sever2-interaction-polish.js?v=78'));
  assert.ok(!cachedAssets.includes('./sever2-interaction-polish.js?v=101'));
  assert.ok(!cachedAssets.includes('./sever2-interaction-polish.js?v=107'));
  assert.ok(!cachedAssets.includes('./sever2-interaction-polish.js?v=108'));

  let activateWork;
  handlers.get('activate')({ waitUntil: promise => { activateWork = promise; } });
  await activateWork;
  for (const stale of [
    'sever-v82-reminders-desktop-v9','sever-v92-unified-release-v1','sever-v93-complete-release-v1','sever-v94-experience-release-v1',
    'sever-v101-reliability-release-v1','sever-v102-desktop-polish-release-v1','sever-v106-missed-tasks-release-v1',
    'sever-v107-instant-response-release-v1','sever-v108-observer-batching-release-v1','sever-v109-progress-habits-release-v1',
    'sever-v110-first-run-onboarding-release-v1'
  ]) assert.ok(deleted.includes(stale), `stale cache not deleted: ${stale}`);
  assert.ok(!deleted.includes(RELEASE_CACHE));
  assert.equal(claimed, true);
  assert.equal(skipped, true);
});

test('installed current release serves planner, Notes, progress, onboarding, Finance and v115 notifications from one release cache', async () => {
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
      return { match: async key => { requests.push(key); return { release: 111, key }; } };
    }
  };
  vm.runInNewContext(source, { self, caches, URL, Response, fetch: async () => { network++; throw Error('network must not update a release'); } });
  const cases = [
    ['?verify=new','navigate','./index.html'],
    ['sever2-efficiency.css?v=old','cors','./sever2-efficiency.css?v=102'],
    ['sever2-home-core.css?v=old','cors','./sever2-home-core.css?v=85'],
    ['sever2-home-core.js?v=old','cors','./sever2-home-core.js?v=85'],
    ['sever2-notes-core.js?v=old','cors','./sever2-notes-core.js?v=71'],
    ['sever2-notes-organization.js?v=old','cors','./sever2-notes-organization.js?v=72'],
    ['sever2-notes-editor-flow.css?v=old','cors','./sever2-notes-editor-flow.css?v=90'],
    ['sever2-notes-editor-flow.js?v=old','cors','./sever2-notes-editor-flow.js?v=73'],
    ['sever2-notes-navigation.css?v=old','cors','./sever2-notes-navigation.css?v=74'],
    ['sever2-notes-navigation.js?v=old','cors','./sever2-notes-navigation.js?v=74'],
    ['sever2-notes-polish.css?v=old','cors','./sever2-notes-polish.css?v=92'],
    ['sever2-notes-polish.js?v=old','cors','./sever2-notes-polish.js?v=104'],
    ['sever2-notes-responsiveness-v104.js?v=old','cors','./sever2-notes-responsiveness-v104.js?v=104'],
    ['sever2-mobile-consistency.css?v=old','cors','./sever2-mobile-consistency.css?v=76'],
    ['sever2-notes-compact-v87.css?v=old','cors','./sever2-notes-compact-v87.css?v=87'],
    ['sever2-notes-compact-v87.js?v=old','cors','./sever2-notes-compact-v87.js?v=87'],
    ['sever2-experience-v94.css?v=old','cors','./sever2-experience-v94.css?v=101'],
    ['sever2-experience-v94.js?v=old','cors','./sever2-experience-v94.js?v=101'],
    ['sever2-money.css?v=old','cors','./sever2-money.css?v=83'],
    ['sever2-money.js?v=old','cors','./sever2-money.js?v=83'],
    ['sever2-finance-v111.css?v=old','cors','./sever2-finance-v111.css?v=111'],
    ['sever2-finance-v111.js?v=old','cors','./sever2-finance-v111.js?v=111'],
    ['sever2-usability-v84.css?v=old','cors','./sever2-usability-v84.css?v=93'],
    ['sever2-usability-v84.js?v=old','cors','./sever2-usability-v84.js?v=84'],
    ['sever2-interaction-polish.css?v=old','cors','./sever2-interaction-polish.css?v=103'],
    ['sever2-missed-tasks-v106.css?v=old','cors','./sever2-missed-tasks-v106.css?v=106'],
    ['sever2-interaction-polish.js?v=old','cors','./sever2-interaction-polish.js?v=113'],
    ['sever2-progress-habits-v109.css?v=old','cors','./sever2-progress-habits-v109.css?v=109'],
    ['sever2-progress-habits-v109.js?v=old','cors','./sever2-progress-habits-v109.js?v=109'],
    ['sever2-onboarding-v110.css?v=old','cors','./sever2-onboarding-v110.css?v=110'],
    ['sever2-onboarding-v110.js?v=old','cors','./sever2-onboarding-v110.js?v=110'],
    ['sever2-notes-org-repair-v95.js?v=old','cors','./sever2-notes-org-repair-v95.js?v=111'],
    ['sever2-reminders.css?v=old','cors','./sever2-reminders.css?v=86'],
    ['sever2-task-reminders.js?v=old','cors','./sever2-task-reminders.js?v=115'],
    ['sever2-cloud-recovery.css?v=old','cors','./sever2-cloud-recovery.css?v=80'],
    ['sever2-cloud-recovery.js?v=old','cors','./sever2-cloud-recovery.js?v=80'],
    ['js/theme-init.js?v=old','cors','./js/theme-init.js?v=92'],
    ['js/sever-ai.js?v=old','cors','./js/sever-ai.js?v=100'],
    ['app.js?v=new','cors','./app.js?v=106']
  ];
  for (const [pathValue, mode, expected] of cases) {
    let response;
    handlers.get('fetch')({ request: { method: 'GET', url: 'https://example.test/sever-planner/'+pathValue, mode }, respondWith: promise => { response = promise; } });
    assert.equal((await response).key, expected);
  }
  assert.equal(network, 0);
  assert.equal(requests.length, cases.length);
});