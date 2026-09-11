import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../supabase/migrations/006_cloud_scale_hardening.sql', import.meta.url), 'utf8');

test('cloud scale hardening is additive and indexes every previously unindexed relation', () => {
  for (const index of [
    'focus_sessions_task_id_idx',
    'habit_entries_habit_id_idx',
    'habits_user_id_idx',
    'note_folders_user_id_idx',
    'notes_folder_id_idx'
  ]) assert.match(source, new RegExp(`create index if not exists ${index}`));
  assert.doesNotMatch(source, /\b(delete from|truncate|drop table|alter table .* drop column)\b/i);
});

test('planner and AI RLS policies remain owner-scoped and authenticated-only', () => {
  for (const table of ['tasks','habits','habit_entries','note_folders','notes','focus_sessions','user_settings','ai_memories','ai_plans']) {
    assert.match(source, new RegExp(`on public\\.${table}[\\s\\S]*?to authenticated[\\s\\S]*?user_id = \\(select auth\\.uid\\(\\)\\)`, 'i'));
  }
  assert.match(source, /on public\.profiles[\s\S]*?for select to authenticated[\s\S]*?id = \(select auth\.uid\(\)\)/i);
  assert.match(source, /on public\.ai_usage[\s\S]*?for select to authenticated[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(source, /to public/i);
});

test('auth profile trigger cannot be invoked directly by browser roles', () => {
  assert.match(source, /revoke all on function public\.handle_new_user\(\) from public, anon, authenticated, service_role/i);
  assert.match(source, /grant execute on function public\.handle_new_user\(\) to supabase_auth_admin/i);
});
