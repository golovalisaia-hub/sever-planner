const { test, expect } = require('@playwright/test');

async function seed(page, { onboarded = false, withTask = false } = {}) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(({ onboarded, withTask }) => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded,
      tasks: withTask ? [{ id: 'existing-task', title: 'Уже знакомая задача', date: iso, completed: false, priority: false, category: 'Личное' }] : [],
      notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  }, { onboarded, withTask });
}

async function waitV110(page) {
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severOnboarding === 'v110');
}

test('fresh local user gets automatic quick orientation without manually firing cloud-ready', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await waitV110(page);

  await expect(page.locator('#tourDialog')).toBeVisible();
  await expect(page.locator('#tourTitle')).toHaveText('Добро пожаловать в SEVER');
  await expect(page.locator('#tourText')).toContainText('достаточно одного дела');
  await expect(page.locator('.guide-kicker')).toHaveText('БЫСТРОЕ ЗНАКОМСТВО');
  await expect(page.locator('#sever110GuideStep')).toHaveText('1 / 5');
});

test('quick orientation ends by opening creation of the first real task', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await waitV110(page);
  await expect(page.locator('#tourDialog')).toBeVisible();

  for (let step = 1; step < 5; step += 1) await page.locator('#tourNext').click();
  await expect(page.locator('#sever110GuideStep')).toHaveText('5 / 5');
  await expect(page.locator('#tourTitle')).toHaveText('Остальное — по мере надобности');
  await expect(page.locator('#tourNext')).toHaveText('Добавить первую задачу');
  await page.locator('#tourNext').click();

  await expect(page.locator('#tourDialog')).toBeHidden();
  await expect(page.locator('#taskDialog')).toBeVisible();
  await expect(page.locator('#taskTitle')).toBeFocused();
  expect(await page.evaluate(() => window.SeverApp.getState().onboarded)).toBe(true);
});

test('returning onboarded user is not interrupted and can reopen orientation from Settings', async ({ page }) => {
  await seed(page, { onboarded: true, withTask: true });
  await page.goto('/');
  await waitV110(page);
  await expect(page.locator('#tourDialog')).toBeHidden();

  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await expect(page.locator('#settingsGuide b')).toHaveText('Быстрое знакомство');
  await expect(page.locator('#settingsGuide em')).toContainText('полминуты');
  await page.locator('#settingsGuide').click();
  await expect(page.locator('#tourDialog')).toBeVisible();
  await expect(page.locator('#tourTitle')).toHaveText('Добро пожаловать в SEVER');
  await page.locator('#tourSkip').click();
  await expect(page.locator('#tourDialog')).toBeHidden();
  await expect(page.locator('#settingsView')).toBeVisible();
});

test('skip persists and the empty Today state still tells a novice what to do next', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await waitV110(page);
  await expect(page.locator('#tourDialog')).toBeVisible();
  await page.locator('#tourSkip').click();
  await expect(page.locator('#tourDialog')).toBeHidden();
  expect(await page.evaluate(() => window.SeverApp.getState().onboarded)).toBe(true);

  await expect(page.locator('#todayTasks .empty p')).toContainText('Начни с одного дела');
  await expect(page.locator('#todayTasks .today-add-task')).toContainText('Добавить первую задачу');

  await page.reload();
  await waitV110(page);
  await expect(page.locator('#tourDialog')).toBeHidden();
});

test('quick orientation never creates horizontal overflow on narrow phones', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Narrow-phone guard');
  await seed(page);
  await page.goto('/');
  await waitV110(page);
  await expect(page.locator('#tourDialog')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const card = await page.locator('#tourDialog .guide-card').boundingBox();
  expect(card).not.toBeNull();
  expect(card.x).toBeGreaterThanOrEqual(-1);
  expect(card.x + card.width).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) + 1);
});
