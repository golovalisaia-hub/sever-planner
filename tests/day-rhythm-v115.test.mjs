import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('v115 schedules exactly three local day checkpoints and deduplicates each slot', async () => {
  const migration = await read('supabase/migrations/011_day_rhythm_pushes.sql');
  assert.match(migration, /'morning'::text, '08:30'::time/);
  assert.match(migration, /'afternoon'::text, '14:00'::time/);
  assert.match(migration, /'evening'::text, '20:30'::time/);
  assert.match(migration, /pg_catalog\.pg_timezone_names/);
  assert.match(migration, /unique \(subscription_id, rhythm_kind, local_date\)/);
  assert.match(migration, /on conflict \(subscription_id, rhythm_kind, local_date\) do nothing/);
  assert.match(migration, /due_at > now\(\) - interval '10 minutes'/);
});

test('morning and afternoon skip empty nudges while evening can celebrate a completed day', async () => {
  const migration = await read('supabase/migrations/011_day_rhythm_pushes.sql');
  assert.match(migration, /c\.rhythm_kind = 'morning'[\s\S]*c\.pending_tasks > 0[\s\S]*c\.total_habits - c\.completed_habits > 0/);
  assert.match(migration, /c\.rhythm_kind = 'afternoon'[\s\S]*c\.pending_tasks > 0[\s\S]*c\.total_habits - c\.completed_habits > 0/);
  assert.match(migration, /c\.rhythm_kind = 'evening'[\s\S]*c\.total_tasks > 0[\s\S]*c\.total_habits > 0/);
});

test('afternoon rhythm does not duplicate future exact-time task reminders', async () => {
  const migration = await read('supabase/migrations/011_day_rhythm_pushes.sql');
  const occurrences = migration.match(/d\.rhythm_kind <> 'afternoon'[\s\S]{0,160}t\.scheduled_time is null[\s\S]{0,160}t\.scheduled_time <= d\.local_time/g) || [];
  assert.ok(occurrences.length >= 3, 'pending, priority and next-task queries must all exclude future timed tasks in the afternoon');
});

test('habits are aggregated into the same rhythm instead of producing one push per habit', async () => {
  const migration = await read('supabase/migrations/011_day_rhythm_pushes.sql');
  assert.match(migration, /from public\.habits h/);
  assert.match(migration, /from public\.habit_entries he/);
  assert.match(migration, /pending_habits/);
  assert.match(migration, /next_habit_title/);
  assert.doesNotMatch(migration, /habit_id uuid not null/);
  assert.doesNotMatch(migration, /unique \(habit_id/);
});

test('rhythm claim is server-only and does not add a browser-readable delivery table', async () => {
  const migration = await read('supabase/migrations/011_day_rhythm_pushes.sql');
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.push_rhythm_deliveries from public, anon, authenticated/);
  assert.match(migration, /language sql security invoker/);
  assert.match(migration, /revoke all on function public\.sever_claim_due_rhythm_pushes_v115\(integer\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.sever_claim_due_rhythm_pushes_v115\(integer\) to service_role/);
});

test('dispatcher keeps exact-time reminders working even if rhythm rollout is not ready yet', async () => {
  const source = await read('supabase/functions/sever-push-dispatch/index.ts');
  const taskClaim = source.indexOf("admin.rpc('sever_claim_due_pushes_v96'");
  const rhythmClaim = source.indexOf("admin.rpc('sever_claim_due_rhythm_pushes_v115'");
  assert.ok(taskClaim >= 0 && rhythmClaim > taskClaim);
  assert.match(source, /const rhythmJobs=\(rhythmClaim\.error\?\[\]:\(rhythmClaim\.data\|\|\[\]\)\)/);
  assert.match(source, /rhythmClaimError=rhythmClaim\.error\?'CLAIM_FAILED':null/);
});

test('rhythm copy is calm, contextual and never marked high priority', async () => {
  const source = await read('supabase/functions/sever-push-dispatch/index.ts');
  assert.match(source, /title:'Старт дня'/);
  assert.match(source, /title:'Ритм дня'/);
  assert.match(source, /title:'Закроем день спокойно'/);
  assert.match(source, /title:'День закрыт'/);
  assert.match(source, /completed_habits/);
  assert.match(source, /Следующий шаг/);
  assert.match(source, /urgency:'normal'/);
  assert.match(source, /urgency:first\.reminder_kind==='fifteen_minutes'\?'high':'normal'/);
  assert.doesNotMatch(source, /виноват|ленив|провал|стыд|сорвал/i);
});

test('completed days route to progress while unfinished rhythm routes to Today', async () => {
  const source = await read('supabase/functions/sever-push-dispatch/index.ts');
  assert.match(source, /title:'День закрыт'[\s\S]*url:'\.\/\?view=progress'/);
  assert.match(source, /title:'Закроем день спокойно'[\s\S]*url:'\.\/\?view=today'/);
});
