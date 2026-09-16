import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/sever-push-iphone-retry/index.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/015_iphone_push_retry_v121.sql',import.meta.url),'utf8');

test('iPhone retry requires cron token and exactly one owner Apple installation',()=>{
  assert.match(source,/req\.method!=='POST'/);
  assert.match(source,/x-sever-cron-token/);
  assert.match(source,/timingSafeEqual\(a,b\)/);
  assert.match(source,/return reply\(\{error:'UNAUTHORIZED'\},401\)/);
  assert.match(source,/\.eq\('role','owner'\)\.limit\(2\)/);
  assert.match(source,/owners\.data\?\.length!==1/);
  assert.match(source,/\.eq\('user_id',owners\.data\[0\]\.id\)\.eq\('enabled',true\)/);
  assert.match(source,/subs\.data\?\.length!==2/);
  assert.match(source,/url\.hostname==='web\.push\.apple\.com'/);
  assert.match(source,/apple\.length!==1/);
  assert.match(source,/return reply\(\{error:'APPLE_SCOPE'\},409\)/);
});

test('second push requires first successful attempt and reserves unique new ledger before send',()=>{
  assert.match(source,/\.from\('push_probe_attempts_v120'\)/);
  assert.match(source,/prior\.data\?\.status!=='sent'\|\|prior\.data\?\.http_status!==201/);
  assert.match(source,/return reply\(\{error:'PRIOR_TEST_REQUIRED'\},409\)/);
  const reserve=source.indexOf(".insert({subscription_id:device.id,status:'claimed'})");
  const send=source.indexOf('webpush.sendNotification(');
  assert.ok(reserve>0&&send>reserve);
  assert.match(source,/claim\.error\.code==='23505'\?'already_attempted':'ledger_error'/);
  assert.match(migration,/subscription_id uuid primary key references public\.push_subscriptions\(id\)/i);
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/revoke all on table public\.push_iphone_retry_v121 from public, anon, authenticated/i);
  assert.match(migration,/grant select, insert, update on table public\.push_iphone_retry_v121 to service_role/i);
  assert.doesNotMatch(migration,/\bendpoint\b\s+(?:text|varchar)|\bp256dh\b\s+(?:text|varchar)|\bcron_token\b\s+(?:text|varchar)/i);
});

test('second notification gets a distinct tag and exposes no keys or raw provider errors',()=>{
  assert.match(source,/tag:'sever-iphone-retry-v121'/);
  assert.match(source,/title:'SEVER · повторная проверка'/);
  assert.match(source,/\{TTL:600,urgency:'high',topic:'sever-iphone-v121'\}/);
  assert.match(source,/allowedReasons\.has\(reason\)\?reason:'UNCLASSIFIED'/);
  assert.match(source,/typeof body!=='string'\|\|body\.length>8192/);
  assert.doesNotMatch(source,/console\.(?:log|warn|error)|JSON\.stringify\(error\)|\.unsubscribe\(|\.from\('push_subscriptions'\)\.update/);
  assert.doesNotMatch(source,/return reply\([^\n]*(?:secrets\.vapid|device\.endpoint|device\.auth|device\.p256dh)/);
});
