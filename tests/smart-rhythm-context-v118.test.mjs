import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/013_smart_rhythm_context.sql', import.meta.url), 'utf8');

test('v118 preserves the deployed RPC output, permissions, local slots and one-per-day deduplication', () => {
  assert.match(sql, /create or replace function public\.sever_claim_due_rhythm_pushes_v115\(p_limit integer default 100\)/i);
  for (const field of ['delivery_id bigint','subscription_id uuid','rhythm_kind text','pending_tasks integer','next_task_title text','completed_habits integer','next_habit_title text']) assert.ok(sql.includes(field), field);
  assert.match(sql, /language sql security invoker/);
  assert.match(sql, /revoke all on function public\.sever_claim_due_rhythm_pushes_v115\(integer\)[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.sever_claim_due_rhythm_pushes_v115\(integer\)[\s\S]*to service_role/);
  for (const kindTime of ["'morning'::text, '08:30'::time", "'afternoon'::text, '14:00'::time", "'evening'::text, '20:30'::time"]) assert.ok(sql.includes(kindTime));
  assert.match(sql, /on conflict \(subscription_id,rhythm_kind,local_date\) do nothing/);
  assert.match(sql, /pd\.status in \('claimed','sent'\)/);
});

test('morning summarizes today but only proposes an untimed or near-term task', () => {
  assert.match(sql, /d\.rhythm_kind='morning' or t\.scheduled_time is null[\s\S]*t\.scheduled_time <= d\.local_time/);
  assert.match(sql, /d\.rhythm_kind='morning'[\s\S]*t\.scheduled_time <= \(d\.local_time \+ interval '60 minutes'\)::time/);
  assert.match(sql, /c\.rhythm_kind='morning' and[\s\S]*c\.next_task_title is not null or c\.total_habits>c\.completed_habits/);
  assert.match(sql, /t\.scheduled_time is null[\s\S]*d\.rhythm_kind='morning'/);
});

test('afternoon and evening only count due or untimed tasks, leaving future timed tasks to exact reminders', () => {
  assert.match(sql, /d\.rhythm_kind='morning' or t\.scheduled_time is null\s+or t\.scheduled_time <= d\.local_time/);
  assert.match(sql, /d\.rhythm_kind<>'morning' and t\.scheduled_time <= d\.local_time/);
  assert.match(sql, /c\.rhythm_kind='afternoon' and[\s\S]*c\.pending_tasks>0 or c\.total_habits>c\.completed_habits/);
});

test('evening celebrates only a genuinely completed plan, not future unstarted tasks', () => {
  assert.match(sql, /completed_tasks/);
  assert.match(sql, /c\.rhythm_kind='evening' and \([\s\S]*c\.pending_tasks>0 or c\.total_habits>c\.completed_habits/);
  assert.match(sql, /c\.completed_tasks=c\.total_tasks[\s\S]*c\.completed_habits=c\.total_habits/);
  assert.doesNotMatch(sql, /c\.rhythm_kind='evening' and \(c\.total_tasks>0 or c\.total_habits>0\)\)/);
});

test('habits still share the rhythm instead of creating independent pushes', () => {
  assert.match(sql, /from public\.habits h/);
  assert.match(sql, /from public\.habit_entries he/);
  assert.match(sql, /pending_habits/);
  assert.match(sql, /next_habit_title/);
  assert.doesNotMatch(sql, /create table/);
});
