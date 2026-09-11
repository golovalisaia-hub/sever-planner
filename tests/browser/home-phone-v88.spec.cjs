const { test, expect } = require('@playwright/test');

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function boot(page, { tasks = 'default' } = {}) {
  const today = isoToday();
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(({ today, mode }) => {
    const seeded = mode === 'empty' ? [] : [
      { id: 'home-main', title: 'Главное дело', date: today, time: '10:00', duration: 45, category: 'Личное', priority: true, challenge: false, completed: false, createdAt: 1, updatedAt: 1 },
      { id: 'home-next', title: 'Небольшая задача', date: today, time: '15:30', duration: 20, category: 'Другое', priority: false, challenge: false, completed: false, createdAt: 2, updatedAt: 2 },
      { id: 'home-done', title: 'Готово', date: today, time: '', duration: 0, category: 'Личное', priority: false, challenge: false, completed: true, completedAt: Date.now(), createdAt: 3, updatedAt: 3 }
    ];
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: true, tasks: seeded, notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  }, { today, mode: tasks });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severHomeCore === 'ready');
  await page.evaluate(() => window.SeverApp.switchView('today'));
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('phone Home has one stable hierarchy without duplicate focus and utility blocks', async ({ page }, info) => {
  if (info.project.name === 'desktop') test.skip();

  await expect(page.locator('#todayView')).toBeVisible();
  await expect(page.locator('#sever2HomeCore')).toBeVisible();
  await expect(page.locator('#todayView .sever2-home-priority')).toBeHidden();
  await expect(page.locator('#todayView .today-utilities')).toBeHidden();
  await expect(page.locator('#todayView .today-dashboard')).toBeHidden();
  await expect(page.locator('#todayView .today-list-head')).toBeVisible();
  await expect(page.locator('#todayView #todayFilters')).toBeVisible();
  await expect(page.locator('#todayView #todayTasks')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const top = selector => document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
    const visibleActions = [...document.querySelectorAll('#sever2HomeCore .sever2-home-now-actions button')]
      .filter(button => {
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
    const actionHeights = visibleActions.map(button => button.getBoundingClientRect().height);
    const taskShadows = [...document.querySelectorAll('#todayView #todayTasks .task')]
      .map(task => getComputedStyle(task).boxShadow);
    return {
      hero: top('#todayView > .today-hero'),
      core: top('#todayView > #sever2HomeCore'),
      listHead: top('#todayView > .today-list-head'),
      filters: top('#todayView > #todayFilters'),
      list: top('#todayView > #todayTasks'),
      actionCount: visibleActions.length,
      actionHeights,
      taskShadows,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
    };
  });

  expect(geometry.hero).toBeLessThan(geometry.core);
  expect(geometry.core).toBeLessThan(geometry.listHead);
  expect(geometry.listHead).toBeLessThan(geometry.filters);
  expect(geometry.filters).toBeLessThan(geometry.list);
  expect(geometry.actionCount).toBe(1);
  expect(Math.min(...geometry.actionHeights)).toBeGreaterThanOrEqual(44);
  expect(geometry.taskShadows.every(value => value === 'none')).toBe(true);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
});

test('all three themes keep the same phone Home order and no page overflow', async ({ page }, info) => {
  if (info.project.name === 'desktop') test.skip();

  for (const theme of ['light', 'motion', 'black']) {
    await page.evaluate(value => {
      localStorage.setItem('sever-theme', value);
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.waitForTimeout(30);
    const result = await page.evaluate(() => {
      const order = ['.today-hero', '#sever2HomeCore', '.today-list-head', '#todayFilters', '#todayTasks']
        .map(selector => document.querySelector(`#todayView > ${selector}`)?.getBoundingClientRect().top ?? -1);
      return {
        order,
        utilities: getComputedStyle(document.querySelector('#todayView .today-utilities')).display,
        priority: getComputedStyle(document.querySelector('#todayView .sever2-home-priority')).display,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
      };
    });
    expect(result.order.every((value, index, arr) => index === 0 || value > arr[index - 1]), `${theme} Home order`).toBe(true);
    expect(result.utilities).toBe('none');
    expect(result.priority).toBe('none');
    expect(result.overflow).toBeLessThanOrEqual(1);
  }
});

test('Home focus action opens Timer for the actual primary task', async ({ page }) => {
  await expect(page.locator('#sever2HomeCore [data-home-now-title]')).toHaveText('Главное дело');
  const focus = page.locator('#sever2HomeCore [data-home-action="focus"]');
  await expect(focus).toBeVisible();
  await expect(focus).toHaveAttribute('aria-label', 'Начать фокус: Главное дело');
  await focus.click();
  await expect(page.locator('#timerView')).toBeVisible();
  await expect(page.locator('#todayView')).toBeHidden();
  expect(await page.evaluate(() => {
    const context = window.SeverApp.getContext?.() || {};
    return context.activeTimerId || context.selectedTaskId || '';
  })).toBe('home-main');
});

test('empty Home offers creation without a pointless jump to an empty task list', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: info.project.use.viewport, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await boot(page, { tasks: 'empty' });
    await expect(page.locator('#sever2HomeCore [data-home-now-title]')).toHaveText('План на сегодня свободен');
    await expect(page.locator('#sever2HomeCore [data-home-action="create"]')).toBeVisible();
    await expect(page.locator('#sever2HomeCore [data-home-action="tasks"]')).toHaveCount(2);
    await expect(page.locator('#sever2HomeCore [data-home-action="tasks"]').first()).toBeHidden();
    await expect(page.locator('#sever2HomeCore [data-home-action="focus"]')).toBeHidden();
  } finally {
    await context.close();
  }
});
