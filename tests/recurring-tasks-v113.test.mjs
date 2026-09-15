import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/011_recurring_tasks_v113.sql', 'utf8');
const sync = fs.readFileSync('js/sync-core.mjs', 'utf8');
const cloud = fs.readFileSync('js/cloud-runtime.js', 'utf8');

test('v113 recurrence migration is additive and preserves existing task rows', () => {
  assert.match(migration, /alter table public\.tasks[\s\S]*add column if not exists recurrence_series_id uuid/);
  assert.match(migration, /add column if not exists recurrence_rule jsonb/);
  assert.match(migration, /add column if not exists recurrence_occurrence date/);
  assert.doesNotMatch(migration, /drop table\s+public\.tasks|truncate\s+public\.tasks|delete\s+from\s+public\.tasks/i);
  assert.match(migration, /tasks_user_recurrence_series_idx/);
});

test('v113 recurrence metadata is one atomic field-version register', () => {
  assert.match(migration, /"recurrence":\["recurrence_series_id","recurrence_rule","recurrence_occurrence"\]/);
  assert.match(migration, /\{fields,recurrence\}/);
  assert.match(migration, /not \(sync_versions->'fields' \? 'recurrence'\)/);
});

test('v113 server handshake bumps to protocol 2 before recurrence-aware clients sync', () => {
  assert.match(migration, /sever_sync_protocol\(\)[\s\S]*select 2/);
});

test('v113 client must project recurrence as an atomic task group and require protocol 2', () => {
  assert.match(sync, /recurrence:\s*\['recurrenceSeriesId','recurrenceRule','recurrenceOccurrence'\]/);
  assert.match(sync, /recurrenceSeriesId:task\.recurrenceSeriesId\|\|null/);
  assert.match(sync, /recurrence_rule/);
  assert.match(cloud, /data\s*!==\s*2/);
  assert.match(cloud, /recurrence_series_id:\s*record\.recurrenceSeriesId/);
  assert.match(cloud, /recurrence_rule:\s*record\.recurrenceRule/);
  assert.match(cloud, /recurrence_occurrence:\s*record\.recurrenceOccurrence/);
});

test('v113 client upgrades old v1 field metadata instead of treating missing recurrence as an edit', () => {
  assert.match(sync, /for\s*\(const key of Object\.keys\(FIELD_GROUPS\[collection\]\)\)/);
  assert.match(sync, /meta\.fields\[key\]/);
});
