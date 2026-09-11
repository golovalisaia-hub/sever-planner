const { test, expect } = require('@playwright/test');

async function seedFresh(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: false, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
}

test('first-run guide shows once, skip persists, and Settings can reopen it manually', async ({ page }) => {
  await seedFresh(page);
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severUsability === 'v84');

  await page.evaluate(() => window.dispatchEvent(new Event('sever:cloud-ready')));
  await expect(page.locator('#tourDialog')).toBeVisible();
  await expect(page.locator('#tourTitle')).toHaveText('Добро пожаловать в SEVER');
  await page.locator('#tourSkip').click();
  await expect(page.locator('#tourDialog')).toBeHidden();
  expect(await page.evaluate(() => window.SeverApp.getState().onboarded)).toBe(true);

  await page.reload();
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severUsability === 'v84');
  await page.evaluate(() => window.dispatchEvent(new Event('sever:cloud-ready')));
  await expect(page.locator('#tourDialog')).toBeHidden();

  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await page.locator('#settingsGuide').click();
  await expect(page.locator('#tourDialog')).toBeVisible();
  await expect(page.locator('#tourTitle')).toHaveText('Добро пожаловать в SEVER');
  await page.locator('#tourSkip').click();
  await expect(page.locator('#tourDialog')).toBeHidden();
  await expect(page.locator('#settingsView')).toBeVisible();
});