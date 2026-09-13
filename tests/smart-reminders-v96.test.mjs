import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('v96 dispatcher uses contextual task fields and the versioned claim RPC', async () => {
  const source = await read('supabase/functions/sever-push-dispatch/index.ts');
  assert.match(source, /sever_claim_due_pushes_v96/);
  assert.match(source, /task_category/);
  assert.match(source, /task_priority/);
  assert.match(source, /duration_minutes/);
  assert.match(source, /function taskKind/);
  assert.match(source, /function durationHint/);
});

test('smart reminder copy stays short, supportive and contextual', async () => {
  const source = await read('supabase/functions/sever-push-dispatch/index.ts');
  assert.match(source, /clip\(normalize\(first\.task_title\).*38/);
  assert.match(source, /Через 15 мин/);
  assert.match(source, /Завтра/);
  assert.match(source, /Один спокойный шаг/);
  assert.match(source, /Открой материалы/);
  assert.match(source, /Освободи фокус/);
  assert.match(source, /начни в своём темпе/);
  assert.match(source, /Это важное/);
  assert.doesNotMatch(source, /Скоро начало задачи\./);
  assert.doesNotMatch(source, /Напоминание за 1 день\./);
});

test('v96 coalesces repeated pushes and keeps urgency proportional', async () => {
  const source = await read('supabase/functions/sever-push-dispatch/index.ts');
  assert.match(source, /topic:payload\.topic/);
  assert.match(source, /TTL:first\.reminder_kind==='day_before'\?43200:1200/);
  assert.match(source, /urgency:first\.reminder_kind==='fifteen_minutes'\?'high':'normal'/);
  assert.match(source, /Начни с важного — остальное подождёт/);
});

test('v96 migration exposes context without replacing the stable v82 RPC', async () => {
  const source = await read('supabase/migrations/010_smart_task_push_context.sql');
  assert.match(source, /create or replace function public\.sever_claim_due_pushes_v96/);
  assert.match(source, /coalesce\(t\.category,''\) task_category/);
  assert.match(source, /coalesce\(t\.priority,false\) task_priority/);
  assert.match(source, /t\.duration_minutes/);
  assert.doesNotMatch(source, /drop function public\.sever_claim_due_pushes/);
});
