import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('v115.1 covers the rhythm delivery user foreign key', async () => {
  const migration = await read('supabase/migrations/012_day_rhythm_advisor_hardening.sql');
  assert.match(migration, /create index if not exists push_rhythm_deliveries_user_id_idx/);
  assert.match(migration, /on public\.push_rhythm_deliveries\(user_id\)/);
});

test('v115.1 makes browser denial explicit without granting table access', async () => {
  const migration = await read('supabase/migrations/012_day_rhythm_advisor_hardening.sql');
  assert.match(migration, /create policy "rhythm deliveries deny browser access"/);
  assert.match(migration, /to anon, authenticated/);
  assert.match(migration, /using \(false\)/);
  assert.match(migration, /with check \(false\)/);
  assert.doesNotMatch(migration, /grant .*push_rhythm_deliveries.*(?:anon|authenticated)/is);
});
