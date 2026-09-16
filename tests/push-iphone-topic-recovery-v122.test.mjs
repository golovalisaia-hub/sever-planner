import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/sever-push-iphone-topic-recovery/index.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/016_iphone_topic_recovery_v122.sql',import.meta.url),'utf8');

test('recovery can only address same owner iPhone whose first Apple send succeeded and second failed with BadWebPushTopic',()=>{
  assert.match(source,/req\.method!=='POST'/);
  assert.match(source,/x-sever-cron-token/);
  assert.match(source,/timingSafeEqual\(a,b\)/);
  assert.match(source,/return reply\(\{error:'UNAUTHORIZED'\},401\)/);
  assert.match(source,/\.eq\('role','owner'\)\.limit\(2\)/);
  assert.match(source,/owners\.data\?\.length!==1/);
  assert.match(source,/subs\.data\?\.length!==2/);
  assert.match(source,/url\.hostname==='web\.push\.apple\.com'/);
  assert.match(source,/apple\.length!==1/);
  assert.match(source,/\.from\('push_probe_attempts_v120'\)/);
  assert.match(source,/\.from\('push_iphone_retry_v121'\)/);
  assert.match(source,/first\.data\?\.http_status!==201/);
  assert.match(source,/rejected\.data\?\.reason!=='BadWebPushTopic'/);
  assert.match(source,/return reply\(\{error:'PREVIOUS_RESULTS_REQUIRED'\},409\)/);
});

test('one atomic reservation precedes sending, in new private ledger without erasing earlier records',()=>{
  const claim=source.indexOf(".insert({subscription_id:device.id,status:'claimed'})");
  const send=source.indexOf('webpush.sendNotification(');
  assert.ok(claim>0&&send>claim);
  assert.match(source,/claim\.error\.code==='23505'\?'already_attempted':'ledger_error'/);
  assert.match(migration,/subscription_id uuid primary key references public\.push_subscriptions\(id\)/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all on table public\.push_iphone_topic_recovery_v122 from public, anon, authenticated/);
  assert.match(migration,/grant select, insert, update on table public\.push_iphone_topic_recovery_v122 to service_role/);
  assert.doesNotMatch(source,/\.delete\(|\.unsubscribe\(|console\.(?:log|error|warn)/);
  assert.doesNotMatch(migration,/\bendpoint\s+text\b|\bp256dh\s+text\b|\bvapid_public\s+text\b/);
});

test('Apple request deliberately omits optional HTTP Topic and UI tag is distinct',()=>{
  assert.match(source,/tag:'sever-iphone-topic-recovery-v122'/);
  assert.match(source,/JSON\.stringify\(payload\),\{TTL:600,urgency:'high'\}/);
  assert.doesNotMatch(source,/\{TTL:600,urgency:'high',topic:/);
  assert.match(source,/reasons\.has\(reason\)\?reason:'UNCLASSIFIED'/);
  assert.doesNotMatch(source,/return reply\([^\n]*(?:device\.endpoint|device\.auth|secrets\.vapid_private)/);
});
