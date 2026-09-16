import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dispatcher = readFileSync(new URL('../supabase/functions/sever-push-dispatch/index.ts', import.meta.url), 'utf8');
const recovery = readFileSync(new URL('../supabase/functions/sever-push-iphone-topic-recovery/index.ts', import.meta.url), 'utf8');

test('task and rhythm Web Push requests omit optional HTTP Topic', () => {
  const calls = [...dispatcher.matchAll(/webpush\.sendNotification\(([\s\S]*?)\n\s*\);/g)].map(match => match[1]);
  assert.equal(calls.length, 2, 'both task and rhythm send paths must remain');
  for (const call of calls) {
    assert.doesNotMatch(call, /\btopic\s*:/, 'Apple rejected malformed HTTP Topic with BadWebPushTopic');
    assert.match(call, /\bTTL\s*:/);
    assert.match(call, /\burgency\s*:/);
  }
  assert.match(dispatcher, /tag:`sever-task-/);
  assert.match(dispatcher, /tag:`sever-rhythm-/);
  assert.match(recovery, /JSON\.stringify\(payload\),\{TTL:600,urgency:'high'\}/);
});
