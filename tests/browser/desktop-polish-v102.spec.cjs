const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks: [], notes: [], folders: [],
      habits: [{ id: 'habit-v102', title: 'Спокойная привычка', createdAt: Date.now(), updatedAt: Date.now() }],
      checks: {}, taskMemory: [], profile: { name: 'ADMIN' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
    localStorage.setItem('sever-timer-state:sever-anonymous-state-v1', JSON.stringify({
      minutes: 25, left: 750, end: 0, running: false, startedAt: 0
    }));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.querySelector('#sever2CommandOpen'));
}

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await boot(page);
});

test('desktop topbar stays one row with commands centered and one create action', async ({ page }) => {
  const topbar = page.locator('.topbar');
  const command = page.locator('#sever2CommandOpen');
  await expect(command).toBeVisible();
  await expect(command.locator('kbd')).toHaveText('Ctrl K');
  await expect(page.locator('#globalCommand')).toBeHidden();
  await expect(page.locator('#globalAddBtn')).toBeVisible();
  await expect(page.locator('#severAiOpen')).toBeHidden();

  const geometry = await page.evaluate(() => {
    const top = document.querySelector('.topbar').getBoundingClientRect();
    const command = document.querySelector('#sever2CommandOpen').getBoundingClientRect();
    const create = document.querySelector('#globalAddBtn').getBoundingClientRect();
    return {
      topHeight: top.height,
      scrollHeight: document.querySelector('.topbar').scrollHeight,
      commandCenter: command.top + command.height / 2,
      createCenter: create.top + create.height / 2,
      topCenter: top.top + top.height / 2
    };
  });
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.topHeight + 1);
  expect(Math.abs(geometry.commandCenter - geometry.topCenter)).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.createCenter - geometry.topCenter)).toBeLessThanOrEqual(2);

  await command.click();
  await expect(page.locator('#sever2CommandDialog')).toHaveAttribute('open', '');
  await expect(page.locator('#quickAddDialog')).not.toHaveAttribute('open', '');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+k');
  await expect(page.locator('#sever2CommandDialog')).toHaveAttribute('open', '');
  await expect(page.locator('#quickAddDialog')).not.toHaveAttribute('open', '');
});

test('Home context rail avoids duplicate Quick Note and habits are no longer compressed', async ({ page }) => {
  await expect(page.locator('#todayView')).toBeVisible();
  await expect(page.locator('.desktop-rail .quick-note-card')).toBeHidden();
  const marker = page.locator('#desktopHabitSummary .habit-day').first();
  await expect(marker).toBeVisible();
  const size = await marker.evaluate(node => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(size.height).toBeGreaterThanOrEqual(30);
  expect(size.width).toBeGreaterThanOrEqual(24);
});

test('timer arc reflects remaining time instead of staying decorative', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('timer'));
  await expect(page.locator('#timerDisplay')).toHaveText('12:30');
  const progress = await page.locator('#timerProgress').evaluate(node => ({
    inlineOffset: Number.parseFloat(node.style.strokeDashoffset || '0'),
    dashArray: getComputedStyle(node).strokeDasharray,
    trackStroke: getComputedStyle(document.querySelector('#timerView .timer-track')).stroke,
    progressStroke: getComputedStyle(node).stroke
  }));
  expect(progress.inlineOffset).toBeGreaterThan(240);
  expect(progress.inlineOffset).toBeLessThan(250);
  expect(progress.dashArray).toContain('490.09');
  expect(progress.trackStroke).not.toBe(progress.progressStroke);
});
