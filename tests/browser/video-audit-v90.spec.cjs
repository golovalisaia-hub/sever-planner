const { test, expect } = require('@playwright/test');

async function seedEmptyPlanner(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      challengeStart: new Date().toISOString().slice(0, 10),
      challengeDays: 0,
      challengeName: '',
      tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: 'QA' },
      appearance: { theme: 'aurora', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
  });
}

async function waitReady(page) {
  await page.waitForFunction(() => window.SeverApp && document.querySelector('#settingsMobileIndex'));
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedEmptyPlanner(page);
  await page.goto('/');
  await waitReady(page);
});

test('video audit: empty day plan exposes exactly one add-task action', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('calendar'));
  await page.locator('#calendar .day.today').click();
  await expect(page.locator('#dayDialog')).toBeVisible();
  await expect(page.locator('#dayTaskList .empty')).toBeVisible();
  await expect(page.locator('#dayTaskList .empty .today-add-task')).toHaveCount(0);
  await expect(page.locator('#dayDialog > .day-add-task')).toHaveCount(1);
  await expect(page.locator('#dayDialog > .day-add-task')).toBeVisible();
});

test('video audit: mobile Settings has fast section navigation and manual Guide still opens', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await expect(page.locator('#settingsMobileIndex')).toBeVisible();
  expect(await page.locator('#settingsMobileIndex button').count()).toBeGreaterThanOrEqual(6);

  await page.locator('#settingsGuide').scrollIntoViewIfNeeded();
  await page.locator('#settingsGuide').click();
  await expect(page.locator('#tourDialog')).toBeVisible();
  await expect(page.locator('#tourTitle')).toHaveText('Добро пожаловать в SEVER');
});

test('video audit: rapid mobile sheet switches leave one modal sheet open and no page error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.evaluate(() => {
    document.querySelector('#openNote')?.click();
    document.querySelector('.bottom-nav button[data-mobile-more="true"]')?.click();
    document.querySelector('.bottom-nav button[data-mobile-more="true"]')?.click();
  });

  await expect(page.locator('#mobileMenuSheet')).toBeVisible();
  await expect(page.locator('dialog.mobile-sheet[open]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
