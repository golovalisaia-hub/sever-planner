const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: true, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severMoney === 'ready');
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('Money quick input creates a debt plan, tracks payments and survives reload', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('money'));
  await expect(page.locator('#moneyView')).toBeVisible();
  await expect(page.locator('.desktop-sidebar [data-view="money"]')).toContainText('Деньги');

  await page.locator('#moneyQuickInput').fill('долг 10к до декабря');
  await page.locator('#moneyQuickForm button[type="submit"]').click();
  await expect(page.locator('#moneyItemDialog')).toBeVisible();
  await expect(page.locator('#moneyItemTarget')).toHaveValue('10000');
  await expect(page.locator('#moneyItemDeadline')).toHaveValue(/-12-/);

  await page.locator('#moneyItemName').fill('Машина');
  await page.locator('#moneyItemBudget').fill('2500');
  await page.locator('#moneyItemForm button.primary').click();
  await expect(page.locator('.money-card')).toHaveCount(1);
  await expect(page.locator('.money-card')).toContainText('Машина');
  await expect(page.locator('.money-card')).toContainText(/10.?000/);

  await page.locator('#moneyIncomeEdit').click();
  await page.locator('#moneyIncomeInput').fill('50000');
  await page.locator('#moneyIncomeForm button.primary').click();
  await expect(page.locator('#moneyIncomeTotal')).toContainText(/50.?000/);
  await expect(page.locator('.money-pace')).toContainText(/5%/);

  await page.locator('.money-card .money-primary').click();
  await page.locator('#moneyProgressAmount').fill('1000');
  await page.locator('#moneyProgressForm button.primary').click();
  await expect(page.locator('.money-card-amount')).toContainText(/9.?000/);

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.severMoney === 'ready');
  await page.evaluate(() => window.SeverApp.switchView('money'));
  await expect(page.locator('.money-card')).toContainText('Машина');
  await expect(page.locator('.money-card-amount')).toContainText(/9.?000/);
  await expect(page.locator('#moneyIncomeTotal')).toContainText(/50.?000/);
});

test('Money can create calendar reminders without treating them as actual payments', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('money'));
  await page.locator('[data-money-create="goal"]').click();
  await page.locator('#moneyItemName').fill('Ноутбук');
  await page.locator('#moneyItemTarget').fill('30000');
  await page.locator('#moneyItemBudget').fill('10000');
  await page.locator('#moneyItemForm button.primary').click();

  await page.locator('.money-card-actions button').filter({ hasText: 'В календарь' }).click();
  await expect(page.locator('#moneyScheduleDialog')).toBeVisible();
  await expect(page.locator('#moneyScheduleText')).toContainText('3');
  await page.locator('#moneyScheduleConfirm').click();

  const state = await page.evaluate(() => {
    const s = window.SeverApp.getState();
    const item = s.profile.money.items[0];
    return { taskCount: s.tasks.length, ids: item.calendarTaskIds.length, progress: item.currentAmount };
  });
  expect(state.taskCount).toBe(3);
  expect(state.ids).toBe(3);
  expect(state.progress).toBe(0);
  await expect(page.locator('.money-card-actions button').filter({ hasText: 'Уже в календаре' })).toBeDisabled();
});

test('Money layout has no horizontal overflow on phone widths', async ({ page }, info) => {
  if (info.project.name === 'desktop') test.skip();
  await page.evaluate(() => window.SeverApp.switchView('money'));
  const geometry = await page.evaluate(() => ({
    overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    quickWidth: document.querySelector('.money-quick').getBoundingClientRect().width,
    viewWidth: document.querySelector('#moneyView').getBoundingClientRect().width,
    actions: [...document.querySelectorAll('.money-add-pills button')].map(button => button.getBoundingClientRect().height)
  }));
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.quickWidth).toBeLessThanOrEqual(geometry.viewWidth + 1);
  expect(Math.min(...geometry.actions)).toBeGreaterThanOrEqual(44);
});
