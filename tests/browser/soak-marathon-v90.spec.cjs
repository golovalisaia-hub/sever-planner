const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);

function seededState() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = Date.now();
  return {
    version: 11,
    onboarded: true,
    tasks: [
      { id: 'soak-seed-task', title: 'SOAK стартовая задача', date: today, time: '10:00', duration: 20, category: 'Личное', priority: true, challenge: false, completed: false, createdAt: now, updatedAt: now }
    ],
    notes: [], folders: [],
    habits: [{ id: 'soak-seed-habit', title: 'SOAK привычка', createdAt: now, updatedAt: now }],
    checks: { 'soak-seed-habit': [] },
    taskMemory: [],
    profile: { name: 'SOAK' },
    appearance: { theme: 'light', animations: 'off', reduceEffects: true },
    focusSessions: [], stats: { focusMs: 0, sessions: 0 },
    reminders: { enabled: false, time: '19:00', lastDate: '' },
    security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
  };
}

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.SEVER_SUPABASE_CONFIG={};window.SEVER_CLOUD_ENABLED=false;'
  }));
  await page.addInitScript(state => {
    if (sessionStorage.getItem('sever-e2e-soak-seeded-v1') === '1') return;
    localStorage.clear();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify(state));
    localStorage.setItem('sever-theme', 'light');
    sessionStorage.setItem('sever-e2e-soak-seeded-v1', '1');
  }, seededState());
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes && window.SeverCloudReady);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severMoney)).toBe('ready');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severHomeCore)).toBe('ready');
}

async function switchView(page, name) {
  await page.evaluate(value => window.SeverApp.switchView(value), name);
  await expect.poll(() => page.locator('.view').evaluateAll(nodes => nodes
    .filter(node => getComputedStyle(node).display !== 'none')
    .map(node => node.id))).toEqual([`${name}View`]);
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
  expect(overflow, `${name} horizontal overflow`).toBeLessThanOrEqual(1);
}

async function openQuickCreate(page) {
  const mobile = page.locator('#mobileCreateBtn');
  if (await mobile.isVisible()) await mobile.click();
  else await page.locator('#globalAddBtn').click();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
}

async function createTask(page, title) {
  await switchView(page, 'today');
  await openQuickCreate(page);
  await page.locator('#quickCaptureInput').fill(title);
  await page.locator('#quickCaptureForm button[type="submit"]').click();
  await expect(page.locator('#todayTasks')).toContainText(title);
  return page.evaluate(value => window.SeverApp.getState().tasks.find(task => task.title === value)?.id || '', title);
}

async function waitReadyAfterReload(page) {
  await page.reload();
  await page.waitForFunction(() => window.SeverApp && window.SeverCloudReady && document.documentElement.dataset.severHomeCore === 'ready');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severMoney)).toBe('ready');
}

async function expectMinTarget(locator, min = 44) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, 'touch target has a box').not.toBeNull();
  expect(box.width, `touch target width ${box.width}`).toBeGreaterThanOrEqual(min);
  expect(box.height, `touch target height ${box.height}`).toBeGreaterThanOrEqual(min);
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('long navigation + CRUD + reload soak keeps one coherent planner state', async ({ page }, info) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const views = ['today', 'calendar', 'timer', 'notes', 'habits', 'progress', 'money', 'settings'];

  // Hammer navigation enough times to expose stale view classes, observers and layout drift.
  for (let round = 0; round < 12; round++) {
    for (const view of views) await switchView(page, view);
  }

  const prefix = `SOAK ${info.project.name}`;
  const ids = [];
  for (let i = 1; i <= 6; i++) {
    const id = await createTask(page, `${prefix} ${i}`);
    expect(id).toBeTruthy();
    ids.push(id);

    // Force persistence and bootstrap paths repeatedly, not only once at the end.
    if (i % 2 === 0) {
      await waitReadyAfterReload(page);
      const current = await page.evaluate(value => window.SeverApp.getState().tasks.filter(task => task.title.startsWith(value)).length, prefix);
      expect(current).toBe(i);
    }
  }

  // Delete/Undo the same real entities repeatedly; exact ids must survive Undo.
  await switchView(page, 'today');
  for (const id of ids.slice(0, 3)) {
    const title = await page.evaluate(taskId => window.SeverApp.getState().tasks.find(task => task.id === taskId)?.title || '', id);
    const card = page.locator('#todayTasks .task').filter({ hasText: title });
    await card.locator('.task-open').click();
    await page.locator('#taskActionDelete').click();
    await expect.poll(() => page.evaluate(taskId => window.SeverApp.getState().tasks.some(task => task.id === taskId), id)).toBe(false);
    await page.locator('#toast button').click();
    await expect.poll(() => page.evaluate(taskId => window.SeverApp.getState().tasks.some(task => task.id === taskId), id)).toBe(true);
  }

  const before = await page.evaluate(value => window.SeverApp.getState().tasks
    .filter(task => task.title.startsWith(value))
    .map(task => task.id)
    .sort(), prefix);
  await waitReadyAfterReload(page);
  const after = await page.evaluate(value => window.SeverApp.getState().tasks
    .filter(task => task.title.startsWith(value))
    .map(task => task.id)
    .sort(), prefix);
  expect(after).toEqual(before);
  expect(after).toHaveLength(6);
  expect(pageErrors).toEqual([]);
});

test('key phone actions keep comfortable touch targets across primary sections', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'touch-target soak is phone-only');

  await switchView(page, 'today');
  await expectMinTarget(page.locator('#mobileCreateBtn'));

  await switchView(page, 'money');
  await expectMinTarget(page.locator('[data-money-create="debt"]'));
  await expectMinTarget(page.locator('[data-money-create="goal"]'));
  await expectMinTarget(page.locator('#moneyQuickForm button[type="submit"]'));

  await switchView(page, 'settings');
  await expectMinTarget(page.locator('#settingsGuide'));
  const themes = page.locator('.theme-picker [data-sever-theme]:visible');
  expect(await themes.count()).toBe(3);
  for (let i = 0; i < 3; i++) await expectMinTarget(themes.nth(i));
});
