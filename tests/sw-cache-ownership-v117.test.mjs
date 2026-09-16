import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const currentCache = source.match(/const CACHE = '([^']+)'/)?.[1];

test('SEVER activation deletes its stale caches but never touches other projects on the origin', async () => {
  assert.ok(currentCache?.startsWith('sever-'));
  const handlers = new Map();
  const deleted = [];
  let claimed = false;
  const self = {
    clients: { claim: async () => { claimed = true; } },
    addEventListener: (name, listener) => handlers.set(name, listener)
  };
  const caches = {
    keys: async () => [
      'sever-v109-old-release',
      'other-planner-offline-v7',
      currentCache,
      'workbox-precache-another-project',
      'sever-v110-outdated-release'
    ],
    delete: async name => { deleted.push(name); return true; }
  };
  vm.runInNewContext(source, { self, caches, URL, Response, Promise, fetch: async () => ({}) });
  assert.equal(typeof handlers.get('activate'), 'function');
  let activation;
  handlers.get('activate')({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.deepEqual(deleted.sort(), ['sever-v109-old-release', 'sever-v110-outdated-release'].sort());
  assert.equal(claimed, true);
});
