const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      tasks: [], notes: [], folders: [], habits: [], focusSessions: [],
      onboarded: true
    }));
  });
}

test('desktop uses SEVER 2 shell and task-first Home instead of the legacy dashboard', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await seed(page);
  await page.goto('http://127.0.0.1:41741/');

  await expect(page.locator('.desktop-sidebar')).toBeVisible();
  await expect(page.locator('.desktop-rail')).toBeHidden();
  await expect(page.locator('#todayView .today-hero')).toBeVisible();
  await expect(page.locator('#todayView > .quick button')).toBeVisible();
  await expect(page.locator('#todayView > .quick button')).toHaveText('Добавить');

  const shell = await page.locator('#todayView').evaluate(el => getComputedStyle(el).gridTemplateColumns);
  expect(shell.split(' ').filter(Boolean).length).toBeGreaterThanOrEqual(2);

  const bodyBackground = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundImage);
  expect(bodyBackground).not.toContain('aurora.webp');

  expect(await page.locator('.desktop-rail .quick-note-card:visible').count()).toBe(0);
  expect(await page.locator('#todayView .mobile-quick-note:visible').count()).toBe(1);

  await context.close();
});

test('core pages render inside the same SEVER 2 visual system', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await seed(page);
  await page.goto('http://127.0.0.1:41741/');

  for (const [view, selector] of [
    ['calendar', '#calendarView .calendar'],
    ['notes', '#notesView .note-search'],
    ['timer', '#timerView .focus-card'],
    ['progress', '#progressView .stats'],
    ['habits', '#habitsView .habit-list'],
    ['settings', '#settingsView .settings-list']
  ]) {
    await page.locator(`.side-nav [data-view="${view}"]`).click();
    await expect(page.locator(`#${view}View`)).toBeVisible();
    await expect(page.locator(selector)).toBeVisible();
  }

  await context.close();
});

test('mobile keeps app composition and does not inherit desktop rail or page wallpaper', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await seed(page);
  await page.goto('http://127.0.0.1:41741/');

  await expect(page.locator('.desktop-sidebar')).toBeHidden();
  await expect(page.locator('.desktop-rail')).toBeHidden();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect(page.locator('#todayView .today-hero')).toBeVisible();

  const bodyBackground = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundImage);
  expect(bodyBackground).not.toContain('aurora.webp');

  await context.close();
});
