import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reminders = fs.readFileSync(new URL('../sever2-task-reminders.js', import.meta.url), 'utf8');
const interaction = fs.readFileSync(new URL('../sever2-interaction-polish.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/007_task_push_reminders.sql', import.meta.url), 'utf8');

test('settings guide is wired to the existing SEVER guide instead of a second guide implementation', () => {
  assert.match(reminders, /#settingsGuide/);
  assert.match(reminders, /startGuide\?\.\(\{manual:true\}\)/);
  assert.match(reminders, /switchView\?\.\('settings'\)/);
});

test('task reminders request permission only from explicit controls and use Web Push subscription', () => {
  assert.match(reminders, /Notification\.requestPermission\(\)/);
  assert.match(reminders, /pushManager\.subscribe/);
  assert.match(reminders, /applicationServerKey/);
  assert.match(reminders, /push_subscriptions/);
  assert.match(reminders, /dayBefore:true/);
  assert.match(reminders, /fifteenMinutes:true/);
  assert.match(reminders, /isStandalone\(\)/);
});

test('legacy daily reminder is retired and the v82 layer is loaded by the existing presentation stack', () => {
  assert.match(reminders, /current\.reminders\.enabled = false/);
  assert.match(interaction, /sever2-task-reminders\.js\?v=82/);
  assert.match(interaction, /sever2-reminders\.css\?v=82/);
});

test('service worker immediately displays visible push notifications and opens the routed SEVER view', () => {
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /sever2-task-reminders\.js\?v=82/);
  assert.match(sw, /new URL\(event\.notification\.data\?\.url/);
});

test('database layer deduplicates reminder deliveries and schedules the dispatcher once per minute', () => {
  assert.match(migration, /unique \(task_id, subscription_id, reminder_kind, due_at\)/);
  assert.match(migration, /reminder_kind in \('day_before','fifteen_minutes'\)/);
  assert.match(migration, /sever_claim_due_pushes/);
  assert.match(migration, /'\* \* \* \* \*'/);
  assert.match(migration, /sever_push_cron_token/);
});
