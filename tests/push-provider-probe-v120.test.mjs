import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/sever-push-probe/index.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/014_push_provider_probe.sql',import.meta.url),'utf8');

test('v120 is cron-authenticated and strictly limited to two enabled devices of the one owner',()=>{
  assert.match(source,/req\.method!=='POST'/);
  assert.match(source,/x-sever-cron-token/);
  assert.match(source,/timingSafeEqual\(a,b\)/);
  assert.match(source,/return reply\(\{error:'UNAUTHORIZED'\},401\)/);
  assert.match(source,/\.eq\('role','owner'\)\.limit\(2\)/);
  assert.match(source,/owners\.data\?\.length!==1/);
  assert.match(source,/\.eq\('user_id',owners\.data\[0\]\.id\)\.eq\('enabled',true\)/);
  assert.match(source,/\.limit\(3\)/);
  assert.match(source,/subs\.data\?\.length!==2/);
  assert.match(source,/new Set\(devices\.map\(item=>item\.provider\)\)\.size!==2/);
  assert.match(source,/url\.hostname==='web\.push\.apple\.com'/);
  assert.match(source,/url\.hostname==='fcm\.googleapis\.com'/);
});

test('v120 reserves before sending, excludes provider secrets, and never retries a reserved device',()=>{
  const claim=source.indexOf(".insert({subscription_id:device.id,provider,status:'claimed'})");
  const send=source.indexOf('webpush.sendNotification(');
  assert.ok(claim>0&&send>claim);
  assert.match(source,/claim\.error\.code==='23505'\?'already_attempted':'ledger_error'/);
  assert.match(source,/if\(claim\.error\)\{[\s\S]*?continue;/);
  assert.match(migration,/subscription_id uuid primary key references public\.push_subscriptions\(id\) on delete cascade/i);
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/revoke all on table public\.push_probe_attempts_v120 from public, anon, authenticated/i);
  assert.match(migration,/grant select, insert, update on table public\.push_probe_attempts_v120 to service_role/i);
  assert.doesNotMatch(migration,/^\s*(?:endpoint|p256dh|vapid_public|vapid_private|auth|cron_token)\s+(?:text|varchar|bytea)/im);
  assert.doesNotMatch(source,/console\.(?:log|warn|error)|JSON\.stringify\(error\)|\.unsubscribe\(|push_subscriptions'\)\.update/);
});

test('v120 persists and returns only allowlisted provider reason codes, not raw error bodies',()=>{
  assert.match(source,/allowedReasons\.has\(reason\)\?reason:'UNCLASSIFIED'/);
  assert.match(source,/maybe\.body\.length>8192/);
  assert.match(source,/return reply\(\{ok:true,results\}\)/);
  assert.match(source,/status:'sent',http_status:httpStatus,reason:null/);
  assert.match(source,/status:'failed',http_status:httpStatus,reason,finished_at/);
  assert.doesNotMatch(source,/results\.push\(\{[^\n]*endpoint|results\.push\(\{[^\n]*auth|results\.push\(\{[^\n]*vapid/);
});
