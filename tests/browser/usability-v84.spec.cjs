const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    if (localStorage.getItem('sever-e2e-usability-v84-seeded-v1') === '1') return;
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: true, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: 'SEVER' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
    localStorage.setItem('sever-e2e-usability-v84-seeded-v1', '1');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp
    && window.SeverCloudReady
    && document.documentElement.dataset.severMoney === 'ready'
    && document.documentElement.dataset.severUsability === 'v84'
    && document.documentElement.dataset.severReminders === 'v82');
}

async function createPlan(page, { type = 'goal', name = 'План', target = '30000', budget = '10000' } = {}) {
  await page.evaluate(() => window.SeverApp.switchView('money'));
  await page.locator(`[data-money-create="${type}"]`).click();
  await page.locator('#moneyItemName').fill(name);
  await page.locator('#moneyItemTarget').fill(target);
  await page.locator('#moneyItemBudget').fill(budget);
  await page.locator('#moneyItemForm button.primary').click();
  await expect(page.locator('.money-card').filter({ hasText: name })).toBeVisible();
}

async function addSchedule(page, name) {
  const card = page.locator('.money-card').filter({ hasText: name });
  await card.locator('.money-card-actions button').filter({ hasText: 'В календарь' }).click();
  await expect(page.locator('#moneyScheduleDialog')).toBeVisible();
  await page.locator('#moneyScheduleConfirm').click();
  await expect(card.locator('.money-card-actions button').filter({ hasText: 'Уже в календаре' })).toBeDisabled();
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('editing a Money plan keeps completed payment history and removes stale pending reminders', async ({ page }) => {
  await createPlan(page, { type: 'goal', name: 'Ноутбук', target: '30000', budget: '10000' });
  await addSchedule(page, 'Ноутбук');

  const seeded = await page.evaluate(() => {
    const state = window.SeverApp.getState();
    const item = state.profile.money.items.find(row => row.title === 'Ноутбук');
    const first = state.tasks.find(task => task.id === item.calendarTaskIds[0]);
    first.completed = true;
    first.completedAt = Date.now();
    first.updatedAt = Date.now();
    return { count: state.tasks.length, ids: [...item.calendarTaskIds] };
  });
  expect(seeded.count).toBe(3);
  expect(seeded.ids).toHaveLength(3);

  const card = page.locator('.money-card').filter({ hasText: 'Ноутбук' });
  await card.locator('.money-icon-action').click();
  await page.locator('#moneyItemBudget').fill('7500');
  await page.locator('#moneyItemForm button.primary').click();

  const after = await page.evaluate(() => {
    const state = window.SeverApp.getState();
    const item = state.profile.money.items.find(row => row.title === 'Ноутбук');
    return {
      tasks: state.tasks.map(task => ({ id: task.id, completed: task.completed, title: task.title })),
      refs: [...item.calendarTaskIds],
      budget: item.monthlyBudget
    };
  });
  expect(after.tasks).toHaveLength(1);
  expect(after.tasks[0].completed).toBe(true);
  expect(after.tasks[0].title).toContain('Ноутбук');
  expect(after.refs).toEqual([]);
  expect(after.budget).toBe(7500);
  await expect(card.locator('.money-card-actions button').filter({ hasText: 'В календарь' })).toBeEnabled();

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.severUsability === 'v84');
  const persisted = await page.evaluate(() => {
    const state = window.SeverApp.getState();
    return { taskCount: state.tasks.length, completed: state.tasks[0]?.completed, refs: state.profile.money.items[0].calendarTaskIds.length };
  });
  expect(persisted).toEqual({ taskCount: 1, completed: true, refs: 0 });
});

test('finishing a Money plan clears its remaining generated calendar reminders', async ({ page }) => {
  await createPlan(page, { type: 'debt', name: 'Кредит', target: '10000', budget: '5000' });
  await addSchedule(page, 'Кредит');
  expect(await page.evaluate(() => window.SeverApp.getState().tasks.length)).toBe(2);

  const card = page.locator('.money-card').filter({ hasText: 'Кредит' });
  await card.locator('.money-primary').click();
  await page.locator('#moneyProgressAmount').fill('10000');
  await page.locator('#moneyProgressForm button.primary').click();

  const after = await page.evaluate(() => {
    const state = window.SeverApp.getState();
    const item = state.profile.money.items.find(row => row.title === 'Кредит');
    return { taskCount: state.tasks.length, refs: item.calendarTaskIds.length, current: item.currentAmount, target: item.targetAmount };
  });
  expect(after).toEqual({ taskCount: 0, refs: 0, current: 10000, target: 10000 });
  await expect(card.locator('.money-primary')).toBeDisabled();
});

test('deleting a Money plan also retires its pending generated calendar reminders', async ({ page }) => {
  await createPlan(page, { type: 'goal', name: 'Поездка', target: '12000', budget: '6000' });
  await addSchedule(page, 'Поездка');
  expect(await page.evaluate(() => window.SeverApp.getState().tasks.length)).toBe(2);

  const card = page.locator('.money-card').filter({ hasText: 'Поездка' });
  await card.locator('.money-icon-action').click();
  await page.locator('#moneyItemDelete').click();
  await expect(page.locator('#moneyItemDelete')).toHaveText('Нажми ещё раз');
  await page.locator('#moneyItemDelete').click();
  await expect(page.locator('#moneyItemDialog')).toBeHidden();

  const after = await page.evaluate(() => ({
    items: window.SeverApp.getState().profile.money.items.length,
    tasks: window.SeverApp.getState().tasks.length
  }));
  expect(after).toEqual({ items: 0, tasks: 0 });
});

test('guide ends with a compact map of Calendar Notes Money and can return to Settings', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await page.locator('#settingsGuide').click();
  await expect(page.locator('#tourDialog')).toBeVisible();
  for (let i = 0; i < 4; i++) await page.locator('#tourNext').click();
  await expect(page.locator('#tourTitle')).toHaveText('Всё под рукой');
  await expect(page.locator('#tourText')).toContainText('Календарь');
  await expect(page.locator('#tourText')).toContainText('Заметки');
  await expect(page.locator('#tourText')).toContainText('Деньги');
  await expect(page.locator('#tourText')).toContainText('Настройках');
  await page.locator('#tourSkip').click();
  await expect(page.locator('#tourDialog')).toBeHidden();
  await expect(page.locator('#settingsView')).toBeVisible();
});

test('v84 keeps Money and Appearance compact without horizontal page overflow on phones', async ({ page }, info) => {
  if (info.project.name === 'desktop') test.skip();
  await page.evaluate(() => window.SeverApp.switchView('money'));
  const money = await page.evaluate(() => {
    const quick = document.querySelector('.money-quick').getBoundingClientRect();
    const input = document.querySelector('#moneyQuickInput').getBoundingClientRect();
    const button = document.querySelector('#moneyQuickForm > button').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.money-summary article')].map(node => node.getBoundingClientRect());
    return {
      width: innerWidth,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      quickWidth: quick.width,
      inputTop: input.top,
      buttonTop: button.top,
      cardTops: cards.map(card => card.top),
      summaryHeight: document.querySelector('.money-summary').getBoundingClientRect().height
    };
  });
  expect(money.overflow).toBeLessThanOrEqual(1);
  if (money.width > 350) expect(Math.abs(money.inputTop - money.buttonTop)).toBeLessThanOrEqual(4);
  else expect(money.buttonTop).toBeGreaterThan(money.inputTop);
  expect(Math.abs(money.cardTops[0] - money.cardTops[1])).toBeLessThanOrEqual(2);
  expect(money.cardTops[2]).toBeGreaterThan(money.cardTops[0]);
  expect(money.summaryHeight).toBeLessThan(210);

  await page.evaluate(() => window.SeverApp.switchView('settings'));
  const settings = await page.evaluate(() => {
    const rail = document.querySelector('.settings-appearance .theme-picker');
    const cards = [...rail.querySelectorAll('[data-sever-theme]')].map(node => node.getBoundingClientRect());
    return {
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      clientWidth: rail.clientWidth,
      scrollWidth: rail.scrollWidth,
      tops: cards.map(card => card.top),
      count: cards.length
    };
  });
  expect(settings.overflow).toBeLessThanOrEqual(1);
  expect(settings.count).toBe(3);
  expect(settings.scrollWidth).toBeGreaterThan(settings.clientWidth);
  expect(Math.abs(settings.tops[0] - settings.tops[1])).toBeLessThanOrEqual(2);
});