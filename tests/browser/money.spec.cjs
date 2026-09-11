const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    if (localStorage.getItem('sever-e2e-money-seeded-v1') === '1') return;
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: true, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
    localStorage.setItem('sever-e2e-money-seeded-v1', '1');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severMoney === 'ready');
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrast(foreground, background) {
  const parse = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const luminance = value => {
    const [r, g, b] = parse(value);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
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

test('Money primary action keeps readable contrast when hovered on desktop', async ({ page }, info) => {
  if (info.project.name !== 'desktop') test.skip();
  await page.evaluate(() => window.SeverApp.switchView('money'));
  await page.locator('[data-money-create="goal"]').click();
  await page.locator('#moneyItemName').fill('Резерв');
  await page.locator('#moneyItemTarget').fill('10000');
  await page.locator('#moneyItemForm button.primary').click();

  const button = page.locator('.money-card-actions .money-primary').first();
  await button.hover();
  const colors = await button.evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(contrast(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5);
});