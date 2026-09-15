import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reminders = fs.readFileSync(new URL('../sever2-task-reminders.js', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('../sever2-reminder-bridge-v95.js', import.meta.url), 'utf8');
const notesRepair = fs.readFileSync(new URL('../sever2-notes-org-repair-v95.js', import.meta.url), 'utf8');
const interaction = fs.readFileSync(new URL('../sever2-interaction-polish.js', import.meta.url), 'utf8');
const mobileUi = fs.readFileSync(new URL('../mobile-ui.js', import.meta.url), 'utf8');
const reminderCss = fs.readFileSync(new URL('../sever2-reminders.css', import.meta.url), 'utf8');
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

test('legacy daily reminder is retired and cannot be re-enabled by old Settings bridges', () => {
  assert.match(reminders, /current\.reminders\.enabled = false/);
  assert.match(bridge, /current\.reminders\.enabled = false/);
  assert.match(bridge, /master\.onchange = null/);
  assert.match(bridge, /legacyTime\.onchange = null/);
  assert.match(bridge, /test\.onclick = null/);
  assert.match(bridge, /guide\.onclick = null/);
  assert.match(bridge, /severReminderBridge = 'v111'/);
  assert.match(interaction, /sever2-task-reminders\.js\?v=82/);
  assert.match(interaction, /sever2-reminder-bridge-v95\.js\?v=95/);
  assert.match(interaction, /sever2-reminders\.css\?v=82/);
  assert.match(sw, /sever2-reminder-bridge-v95\.js\?v=111/);
});

test('v111 keeps the v110.2 iOS Web Push direct-gesture fix', () => {
  assert.match(bridge, /function prewarmIosPush\(\)/);
  assert.match(bridge, /function interceptIosEnable\(event, master\)/);
  assert.match(bridge, /master\.addEventListener\('change', event => \{[\s\S]*interceptIosEnable\(event, master\)[\s\S]*\}, true\)/);
  assert.match(bridge, /iosRegistration\.pushManager\.subscribe\(\{/);
  assert.match(bridge, /applicationServerKey:decodePublicKey\(VAPID_PUBLIC_KEY\)/);
  assert.match(bridge, /master\.dataset\.severIosPushFix = 'v1102'/);
  const start = bridge.indexOf('function interceptIosEnable');
  const end = bridge.indexOf('\n  function boot()', start);
  const body = bridge.slice(start, end);
  const subscribeAt = body.indexOf('pushManager.subscribe');
  const asyncContinuationAt = body.indexOf('void (async () =>');
  assert.ok(subscribeAt >= 0 && asyncContinuationAt > subscribeAt, 'iOS subscribe must start before async continuation');
  assert.equal(body.includes('Notification.requestPermission'), false, 'iOS direct subscription must not consume the gesture with requestPermission first');
});

test('v111 reminder bridge still neutralizes the retired mobile toggle mirror', () => {
  assert.match(mobileUi, /targetToggle\.checked = sourceToggle\.checked/);
  assert.match(bridge, /function isolateLegacyReminderMirror\(master\)/);
  assert.match(bridge, /Object\.getOwnPropertyDescriptor\(HTMLInputElement\.prototype, 'checked'\)/);
  assert.match(bridge, /Object\.defineProperty\(legacy, 'checked'/);
  assert.match(bridge, /descriptor\.get\.call\(master\)/);
  assert.match(bridge, /legacy\.dataset\.severPushProxy = 'true'/);
});

test('v111 reminder health explains ready, empty and cloud-sync-lag states', () => {
  assert.match(bridge, /function refreshReminderHealth\(\)/);
  assert.match(bridge, /client\.from\('tasks'\)/);
  assert.match(bridge, /\.eq\('completed', false\)/);
  assert.match(bridge, /\.is\('deleted_at', null\)/);
  assert.match(bridge, /Подписка работает · .*готов/);
  assert.match(bridge, /ещё .*в облаке\. Проверьте синхронизацию/);
  assert.match(bridge, /Подписка работает · пока нет будущих задач с датой и временем/);
  assert.match(bridge, /severReminderHealth = 'v111'/);
});

test('v95 repairs Notes organization shell if the core summary appears after organization boot', () => {
  assert.match(notesRepair, /#notesCoreSummary/);
  assert.match(notesRepair, /#notesOrganizationTags/);
  assert.match(notesRepair, /#notesPinnedSection/);
  assert.match(notesRepair, /severNotesOrganizationRepair = 'v95'/);
  assert.match(interaction, /sever2-notes-org-repair-v95\.js\?v=95/);
  assert.match(sw, /sever2-notes-org-repair-v95\.js\?v=111/);
});

test('v101 startup never destroys a push subscription before auth has settled', () => {
  assert.doesNotMatch(interaction, /retireStalePushSubscription/);
  assert.doesNotMatch(interaction, /serviceWorker\.getRegistration\(\)/);
  assert.doesNotMatch(interaction, /subscription\?\.unsubscribe\(\)/);
  assert.match(reminders, /event === 'SIGNED_OUT'/);
  assert.match(reminders, /pushSubscription\(\)\.then\(subscription => subscription\?\.unsubscribe\(\)\)/);
  assert.match(sw, /sever2-interaction-polish\.js\?v=109/);
});

test('reminder settings have dedicated wide desktop and compact mobile layouts', () => {
  assert.match(reminderCss, /@media \(min-width: 901px\)/);
  assert.match(reminderCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(reminderCss, /@media \(max-width: 900px\)/);
  assert.match(reminderCss, /grid-template-columns: minmax\(0, 1fr\)/);
});

test('disabled reminder sub-options stay saved but look clearly inactive', () => {
  assert.match(reminderCss, /\.sever-reminder-option:has\(input:disabled\)/);
  assert.match(reminderCss, /opacity:\s*\.66/);
  assert.match(reminderCss, /cursor:\s*not-allowed/);
  assert.match(reminderCss, /\.sever-reminder-option:has\(input:disabled\) \.switch/);
  assert.match(reminderCss, /filter:\s*saturate\(\.45\)/);
  assert.match(sw, /sever2-reminders\.css\?v=86/);
});

test('service worker immediately displays visible push notifications and opens the routed SEVER view', () => {
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /sever2-task-reminders\.js\?v=82/);
  assert.match(sw, /sever2-reminder-bridge-v95\.js\?v=111/);
  assert.match(sw, /new URL\(event\.notification\.data\?\.url/);
});

test('database layer deduplicates reminder deliveries and schedules the dispatcher once per minute', () => {
  assert.match(migration, /unique \(task_id, subscription_id, reminder_kind, due_at\)/);
  assert.match(migration, /reminder_kind in \('day_before','fifteen_minutes'\)/);
  assert.match(migration, /sever_claim_due_pushes/);
  assert.match(migration, /'\* \* \* \* \*'/);
  assert.match(migration, /sever_push_cron_token/);
});
