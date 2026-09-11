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
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
    localStorage.setItem('sever-e2e-reminders-guide-seeded-v1', '1');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severReminders === 'v82');
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

test('task reminder settings are readable and responsive on desktop and phone', async ({ page }) => {
  await expect(page.locator('#settingsNotificationToggle').locator('xpath=ancestor::label[1]')).toContainText('Напоминания о задачах');
  await expect(page.locator('#severReminderDayBefore')).toBeAttached();
  await expect(page.locator('#severReminderFifteen')).toBeAttached();

  const geometry = await page.evaluate(() => {
    const day = document.querySelector('#severReminderDayBefore').closest('.sever-reminder-option').getBoundingClientRect();
    const fifteen = document.querySelector('#severReminderFifteen').closest('.sever-reminder-option').getBoundingClientRect();
    const options = document.querySelector('.sever-reminder-options').getBoundingClientRect();
    return {
      width: innerWidth,
      dayTop: day.top,
      fifteenTop: fifteen.top,
      dayWidth: day.width,
      fifteenWidth: fifteen.width,
      optionsWidth: options.width,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
    };
  });

  expect(geometry.overflow).toBeLessThanOrEqual(1);
  if (geometry.width > 900) {
    expect(Math.abs(geometry.dayTop - geometry.fifteenTop)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.dayWidth - geometry.fifteenWidth)).toBeLessThanOrEqual(2);
    expect(geometry.dayWidth).toBeLessThan(geometry.optionsWidth * 0.6);
  } else {
    expect(geometry.fifteenTop).toBeGreaterThan(geometry.dayTop);
    expect(geometry.dayWidth).toBeGreaterThan(geometry.optionsWidth * 0.9);
  }
});

test('disabled reminder kinds look inactive without losing the saved choices', async ({ page }) => {
  const day = page.locator('#severReminderDayBefore');
  const fifteen = page.locator('#severReminderFifteen');
  await expect(page.locator('#settingsNotificationToggle')).not.toBeChecked();
  await expect(day).toBeDisabled();
  await expect(fifteen).toBeDisabled();
  await expect(day).toBeChecked();
  await expect(fifteen).toBeChecked();

  const visual = await page.evaluate(() => {
    const row = document.querySelector('#severReminderDayBefore').closest('.sever-reminder-option');
    const toggle = row.querySelector('.switch');
    const rowStyle = getComputedStyle(row);
    const toggleStyle = getComputedStyle(toggle);
    return {
      opacity: Number(rowStyle.opacity),
      cursor: rowStyle.cursor,
      switchOpacity: Number(toggleStyle.opacity),
      background: rowStyle.backgroundColor
    };
  });
  expect(visual.opacity).toBeLessThanOrEqual(0.7);
  expect(visual.cursor).toBe('not-allowed');
  expect(visual.switchOpacity).toBeLessThanOrEqual(0.55);
  expect(visual.background).not.toBe('rgba(0, 0, 0, 0)');
});
