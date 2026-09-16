import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = async path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('v126 live check is Apple-only, single-use and does not add Topic', async () => {
  const source = await read('supabase/functions/sever-push-iphone-live-check/index.ts');
  const migration = await read('supabase/migrations/017_iphone_live_check_v126.sql');
  assert.match(source, /push_iphone_live_check_v126/);
  assert.match(source, /hostname==='web\.push\.apple\.com'/);
  assert.match(source, /apple\.length!==1/);
  assert.match(source, /insert\(\{subscription_id:device\.id,status:'claimed'\}\)/);
  assert.match(source, /JSON\.stringify\(payload\),\{TTL:600,urgency:'high'\}/);
  assert.doesNotMatch(source, /topic\s*:/i);
  // Check only actual logging and response-object fields, not the auth guard itself.
  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(source, /return reply\(\{[^\n}]*\b(?:endpoint|p256dh|auth|vapid_private|cron_token)\b/);
  assert.match(migration, /subscription_id uuid primary key/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all .* from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update .* to service_role/);
});
