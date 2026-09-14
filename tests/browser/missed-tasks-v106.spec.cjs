const { test, expect } = require('@playwright/test');

function iso(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    const toIso = offset => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    const now = Date.now();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tourSeen: true,
      tasks: [
        { id: 'missed-v106', title: 'Вчерашняя задача', date: toIso(-1), time: '', duration: 20, category: 'Личное', priority: false, challenge: false, completed: false, createdAt: now - 86400000, updatedAt: now - 86400000 },
        { id: 'today-v106', title: 'Сегодняшняя задача', date: toIso(0), time: '', duration: 15, category: 'Личное', priority: false, challenge: false, completed: false, createdAt: now, updatedAt: now }
      ],
      notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp);
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test('overdue tasks keep their original date until the user explicitly moves them', async ({ page }) => {
  const yesterday = iso(-1);
  const today = iso(0);
  const block = page.locator('#missedTasksBlock');

  await expect(block).toBeVisible();
  await expect(block.locator('.missed-count')).toHaveText('1');
  await expect(block.locator('.missed-task')).toHaveCount(1);
  await expect(block).toContainText('Вчерашняя задача');
  await expect(page.locator('#todayTasks .task')).toHaveCount(1);
  await expect(page.locator('#todayTasks')).toContainText('Сегодняшняя задача');
  await expect(page.locator('#todayTasks')).not.toContainText('Вчерашняя задача');

  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'missed-v106')?.date)).toBe(yesterday);

  await block.locator('[data-missed-action="today"]').click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'missed-v106')?.date)).toBe(today);
  await expect(block).toBeHidden();
  await expect(page.locator('#todayTasks .task')).toHaveCount(2);

  const undo = page.locator('#toast button');
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'missed-v106')?.date)).toBe(yesterday);
  await expect(block).toBeVisible();
});

test('completing a missed task preserves the historical day across reload', async ({ page }) => {
  const yesterday = iso(-1);
  const block = page.locator('#missedTasksBlock');
  await expect(block).toBeVisible();

  await block.locator('.missed-check').click();
  await expect.poll(() => page.evaluate(() => {
    const task = window.SeverApp.getState().tasks.find(item => item.id === 'missed-v106');
    return task ? { completed: task.completed, date: task.date } : null;
  })).toEqual({ completed: true, date: yesterday });
  await expect(block).toBeHidden();

  await page.waitForTimeout(250);
  await page.reload();
  await page.waitForFunction(() => window.SeverApp);
  await expect.poll(() => page.evaluate(() => {
    const task = window.SeverApp.getState().tasks.find(item => item.id === 'missed-v106');
    return task ? { completed: task.completed, date: task.date } : null;
  })).toEqual({ completed: true, date: yesterday });
});
