const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.SEVER_SUPABASE_CONFIG={};'
  }));
  await page.addInitScript(() => {
    if (localStorage.getItem('sever-e2e-reminders-guide-seeded-v1') === '1') return;
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: 'SEVER' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: true, time: '19:00', lastDate: '2026-09-12' },
      pushReminders: { enabled: false, dayBefore: false, fifteenMinutes: false, legacyRetired: true },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
    localStorage.setItem('sever-e2e-reminders-guide-seeded-v1', '1');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severReminders === 'v82' && document.documentElement.dataset.severReminderBridge === 'v111');
  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await expect(page.locator('#settingsView')).toBeVisible();
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('Settings guide opens from the real Help row and returns to Settings', async ({ page }) => {
  await page.locator('#settingsGuide').click();
  await expect(page.locator('#tourDialog')).toBeVisible();
  await expect(page.locator('#tourTitle')).not.toHaveText('');
  await page.locator('#tourSkip').click();
  await expect(page.locator('#tourDialog')).toBeHidden();
  await expect(page.locator('#settingsView')).toBeVisible();
});

test('legacy daily reminder stays retired even when its old persisted flag was enabled', async ({ page }) => {
  const legacy = await page.evaluate(() => ({
    enabled: window.SeverApp.getState().reminders.enabled,
    lastDate: window.SeverApp.getState().reminders.lastDate,
    masterBridge: document.querySelector('#settingsNotificationToggle').onchange,
    timeBridge: document.querySelector('#settingsNotificationTime').onchange,
    testBridge: document.querySelector('#settingsTestNotification').onclick
  }));
  expect(legacy.enabled).toBe(false);
  expect(legacy.lastDate).toBe('');
  expect(legacy.masterBridge).toBe(null);
  expect(legacy.timeBridge).toBe(null);
  expect(legacy.testBridge).toBe(null);

  await page.evaluate(() => {
    const toggle = document.querySelector('#settingsNotificationToggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().reminders.enabled)).toBe(false);
});

test('v115 settings expose one clear SEVER notification mode on desktop and phone', async ({ page }) => {
  const row = page.locator('#settingsNotificationToggle').locator('xpath=ancestor::label[1]');
  await expect(row).toContainText('Уведомления SEVER');
  await expect(row).toContainText('Ритм дня, задачи и привычки');
  await expect(page.locator('.sever-reminder-note')).toContainText('SEVER напомнит сам');
  await expect(page.locator('.sever-reminder-note')).toContainText('Утром — план дня');
  await expect(page.locator('.sever-reminder-note')).toContainText('днём — один следующий шаг');
  await expect(page.locator('.sever-reminder-note')).toContainText('вечером — спокойное завершение');
  await expect(page.locator('.sever-reminder-note')).toContainText('Привычки входят в общий ритм');
  await expect(page.locator('.sever-reminder-note')).toContainText('за день и за 15 минут');
  await expect(page.locator('#severReminderDayBefore')).toHaveCount(0);
  await expect(page.locator('#severReminderFifteen')).toHaveCount(0);

  const geometry = await page.evaluate(() => {
    const options = document.querySelector('.sever-reminder-options').getBoundingClientRect();
    const note = document.querySelector('.sever-reminder-note').getBoundingClientRect();
    return {
      width: innerWidth,
      noteWidth: note.width,
      optionsWidth: options.width,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
    };
  });

  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.noteWidth).toBeGreaterThan(geometry.optionsWidth * 0.8);
  expect(geometry.noteWidth).toBeLessThanOrEqual(geometry.optionsWidth + 1);
});

test('v115 keeps automatic exact-task defaults without enabling push by itself', async ({ page }) => {
  const master = page.locator('#settingsNotificationToggle');
  await expect(master).not.toBeChecked();

  const prefs = await page.evaluate(() => ({
    ...window.SeverApp.getState().pushReminders,
    mode: document.documentElement.dataset.severReminderMode,
    version: document.documentElement.dataset.severRemindersVersion
  }));
  expect(prefs.enabled).toBe(false);
  expect(prefs.dayBefore).toBe(true);
  expect(prefs.fifteenMinutes).toBe(true);
  expect(prefs.automatic).toBe(true);
  expect(prefs.mode).toBe('rhythm-v115');
  expect(prefs.version).toBe('v115');

  // Reproduce the old phone mirror race: writes to the retired hidden source
  // must never turn the visible push master on.
  await page.evaluate(() => {
    const legacy = document.querySelector('#notificationToggle');
    const nativeChecked = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
    nativeChecked.set.call(legacy, true);
    window.dispatchEvent(new Event('resize'));
  });
  await expect(master).not.toBeChecked();
  await expect(page.locator('#severReminderDayBefore')).toHaveCount(0);
  await expect(page.locator('#severReminderFifteen')).toHaveCount(0);
});
