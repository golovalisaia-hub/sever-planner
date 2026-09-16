import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const load = async path => readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('v126 one-shot iPhone check is authenticated, owner-scoped and cannot repeat',async()=>{
  const source=await load('supabase/functions/sever-push-owner-check/index.ts');
  const sql=await load('supabase/migrations/017_owner_iphone_push_check_v126.sql');
  assert.match(source,/req\.method!=='POST'/);
  assert.match(source,/validToken\(req\.headers\.get\('x-sever-cron-token'\)/);
  assert.match(source,/\.eq\('role','owner'\)\.limit\(2\)/);
  assert.match(source,/owners\.data\?\.length!==1/);
  assert.match(source,/url\.hostname==='web\.push\.apple\.com'/);
  assert.match(source,/apple\.length!==1/);
  assert.match(source,/push_iphone_topic_recovery_v122/);
  assert.match(source,/prior\.data\?\.http_status!==201/);
  assert.match(source,/\.insert\(\{subscription_id:device\.id,status:'claimed'\}\)/);
  assert.match(source,/claim\.error\.code==='23505'/);
  assert.match(source,/\{TTL:900,urgency:'high'\}/);
  assert.doesNotMatch(source,/topic\s*:\s*['"`]/i);
  assert.doesNotMatch(source,/console\.|log\(|req\.json\(|localStorage/);
  assert.match(sql,/subscription_id uuid primary key references public\.push_subscriptions\(id\) on delete cascade/);
  assert.match(sql,/alter table public\.push_owner_iphone_check_v126 enable row level security/);
  assert.match(sql,/revoke all on table public\.push_owner_iphone_check_v126 from public, anon, authenticated/);
  assert.match(sql,/for all to anon, authenticated using \(false\) with check \(false\)/);
  assert.doesNotMatch(sql,/\bendpoint\b|\bp256dh\b|\bauth\b|\bvapid_private\b/);
});

test('one-shot payload is one user-visible probe and omits diagnostic credentials',async()=>{
  const source=await load('supabase/functions/sever-push-owner-check/index.ts');
  assert.match(source,/title:'SEVER · проверка доставки № 4'/);
  assert.match(source,/tag:'sever-owner-check-v126'/);
  assert.match(source,/JSON\.stringify\(payload\),\{TTL:900,urgency:'high'\}/);
  assert.match(source,/return reply\(\{ok:!saved\.error,provider:'apple',outcome:/);
  assert.doesNotMatch(source,/return reply\(\{[^\n]*(?:endpoint|auth|p256dh|vapid_private|cron_token)/);
});
