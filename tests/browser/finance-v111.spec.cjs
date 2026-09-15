const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const safeName = value => String(value || 'project').replace(/[^a-z0-9_-]+/gi, '-');
async function shot(page, project, label) {
  const out = path.resolve('visual-review/sever2-v109');
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, `${safeName(project)}-v111-finance-${label}.png`), fullPage: true });
}

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    if (localStorage.getItem('sever-e2e-finance-v111-seeded-v1') === '1') return;
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: true, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: 'SEVER', money: { v: 1, currency: 'RUB', monthlyIncome: 100000, items: [
        { id: 'debt-1', type: 'debt', title: 'Кредит', targetAmount: 30000, currentAmount: 10000, deadline: '', monthlyBudget: 5000, calendarTaskIds: [], createdAt: Date.now(), updatedAt: Date.now() }
      ] } },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true }, focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' }, security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
    localStorage.setItem('sever-e2e-finance-v111-seeded-v1', '1');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severFinance === 'v111');
  await page.evaluate(() => window.SeverApp.switchView('money'));
  await expect(page.locator('#moneyView')).toBeVisible();
  await expect(page.locator('#moneyPageTitle')).toHaveText('Финансы');
}

async function addTransaction(page, type, name, amount, category = 'other') {
  await page.locator(`[data-finance-new="${type}"]`).first().click();
  await expect(page.locator('#financeTransactionDialog')).toBeVisible();
  await page.locator('#financeTransactionName').fill(name);
  await page.locator('#financeTransactionAmount').fill(String(amount));
  if (type === 'expense') await page.locator('#financeTransactionCategory').selectOption(category);
  await page.locator('#financeTransactionForm button.primary').click();
  await expect(page.locator('#financeTransactionDialog')).toBeHidden();
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('Finance v111 replaces sparse Money home with a useful monthly command center', async ({ page }, info) => {
  await expect(page.locator('#financeTabs')).toBeVisible();
  await expect(page.locator('#financeBalance')).toBeVisible();
  await expect(page.locator('#financeInsights')).toBeVisible();
  await expect(page.locator('.finance-ai')).toContainText('Финансовый помощник');
  await expect(page.locator('[data-finance-tab="budget"]')).toBeVisible();
  await expect(page.locator('[data-finance-tab="transactions"]')).toBeVisible();
  await expect(page.locator('[data-finance-tab="plans"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  if (['phone-320', 'phone-390', 'desktop'].includes(info.project.name)) await shot(page, info.project.name, 'overview');
});

test('income, expense and category budget update the month and survive reload', async ({ page }) => {
  await addTransaction(page, 'income', 'Подработка', 20000);
  await addTransaction(page, 'expense', 'Продукты', 3500, 'food');
  await expect(page.locator('#financeIncome')).toContainText('20');
  await expect(page.locator('#financeExpenses')).toContainText('3');

  await page.locator('[data-finance-tab="budget"]').click();
  const food = page.locator('[data-finance-budget="food"]');
  await food.fill('10000');
  await food.blur();
  await expect(page.locator('.finance-budget-row').filter({ hasText: 'Еда' })).toContainText('3');

  const snapshot = await page.evaluate(() => window.SeverApp.getState().profile.finance);
  expect(snapshot.transactions).toHaveLength(2);
  expect(snapshot.budgets.food).toBe(10000);

  await page.reload();
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severFinance === 'v111');
  await page.evaluate(() => window.SeverApp.switchView('money'));
  await page.locator('[data-finance-tab="budget"]').click();
  await expect(page.locator('[data-finance-budget="food"]')).toHaveValue('10000');
  const restored = await page.evaluate(() => window.SeverApp.getState().profile.finance);
  expect(restored.transactions).toHaveLength(2);
  expect(restored.transactions.some(item => item.title === 'Продукты' && item.amount === 3500)).toBe(true);
});

test('recurring payment can be marked once and becomes a real expense transaction', async ({ page }) => {
  await page.locator('[data-finance-tab="transactions"]').click();
  const panel = page.locator('[data-finance-panel="transactions"]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-finance-recurring-new]').click();
  await expect(page.locator('#financeRecurringDialog')).toBeVisible();
  await page.locator('#financeRecurringName').fill('Связь');
  await page.locator('#financeRecurringAmount').fill('990');
  await page.locator('#financeRecurringCategory').selectOption('subscriptions');
  await page.locator('#financeRecurringForm button.primary').click();
  await expect(page.locator('#financeRecurringDialog')).toBeHidden();

  const row = page.locator('.finance-recurring-row').filter({ hasText: 'Связь' });
  await expect(row).toBeVisible();
  await row.locator('[data-finance-recurring-pay]').click();
  await expect(row.locator('[data-finance-recurring-pay]')).toBeDisabled();
  await expect(row.locator('[data-finance-recurring-pay]')).toHaveText('Отмечено');
  await expect(page.locator('.finance-transaction-row').filter({ hasText: 'Связь' })).toBeVisible();

  const state = await page.evaluate(() => window.SeverApp.getState().profile.finance);
  expect(state.recurrings).toHaveLength(1);
  expect(state.transactions.some(item => item.recurringId === state.recurrings[0].id && item.amount === 990)).toBe(true);
});

test('legacy debts remain available as Plans and finance AI is explicit user action', async ({ page }, info) => {
  await page.locator('[data-finance-tab="plans"]').click();
  await expect(page.locator('.money-card').filter({ hasText: 'Кредит' })).toBeVisible();

  await page.locator('[data-finance-tab="overview"]').click();
  await page.locator('[data-finance-ai="month"]').click();
  await expect(page.locator('#severAiPanel')).toHaveClass(/open/);
  await expect(page.locator('#severAiInput')).toHaveValue(/Финансовая сводка SEVER/);
  await expect(page.locator('#severAiInput')).toHaveValue(/Без осуждения/);
  if (['phone-390', 'desktop'].includes(info.project.name)) {
    await page.locator('#severAiClose').click();
    await shot(page, info.project.name, 'plans');
  }
});
