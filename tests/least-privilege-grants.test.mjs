import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/009_least_privilege_table_grants.sql', import.meta.url), 'utf8');

test('anonymous browser has no table privileges on SEVER cloud data', () => {
  assert.match(migration, /revoke all privileges on table[\s\S]*from anon;/i);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)[\s\S]*\bto anon\b/i);
});

test('authenticated browser receives only the Data API actions SEVER uses', () => {
  assert.match(migration, /revoke all privileges on table[\s\S]*from authenticated;/i);
  assert.match(migration, /grant select on table public\.profiles to authenticated;/i);
  assert.match(migration, /grant select on table public\.ai_usage to authenticated;/i);
  assert.match(migration, /grant select, insert, update, delete on table[\s\S]*public\.tasks[\s\S]*public\.push_subscriptions[\s\S]*to authenticated;/i);
  assert.doesNotMatch(migration, /grant\s+[^;]*(?:truncate|trigger|references)[^;]*to authenticated/i);
  assert.doesNotMatch(migration, /grant\s+[^;]*public\.push_deliveries[^;]*to authenticated/i);
});
