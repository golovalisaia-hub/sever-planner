const { test, expect } = require('@playwright/test');

async function boot(page, mode = 'task') {
  await page.route('**/supabase-config.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.SEVER_SUPABASE_CONFIG={};'
  }));
  await page.addInitScript(({ mode }) => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const task = {
      id: 'home-v116-task', title: 'Сделать главное', date: today, time: '', duration: 25,
      category: 'Учёба', priority: true, challenge: false, completed: mode === 'complete', createdAt: Date.now() - 2000
    };
    const habit = { id: 'home-v116-habit', title: '30 минут чтения', createdAt: Date.now() - 86400000 };
    const tasks = mode === 'habit' ? [] : [task];
    const habits = [habit];
    const checks = mode === 'complete' ? { [habit.id]: [today] } : {};
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks,
      notes: [], folders: [], habits, checks, taskMemory: [],
      profile: { name: 'SEVER' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      pushReminders: { enabled: false, dayBefore: true, fifteenMinutes: true, legacyRetired: true },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  }, { mode });
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.severHomeCore === 'v116');
  await expect(page.locator('#sever2HomeCore')).toBeVisible();
}

test('v116 shows one task action and keeps day detail collapsed by default', async ({ page }) => {
  await boot(page, 'task');
  await expect(page.locator('[data-home-now-title]')).toHaveText('Сделать главное');
  const visibleActions = page.locator('.sever2-home-now-actions button:visible');
  await expect(visibleActions).toHaveCount(1);
  await expect(visibleActions).toContainText('Начать фокус');
  await expect(page.locator('[data-home-plan]')).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-home-plan-summary]')).toContainText('2 шага осталось');

  await page.locator('[data-home-plan] > summary').click();
  await expect(page.locator('.sever2-home-stats')).toBeVisible();
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
  expect(overflow).toBeLessThanOrEqual(1);
});

test('v116 falls back to one unfinished habit when there is no task', async ({ page }) => {
  await boot(page, 'habit');
  await expect(page.locator('[data-home-now-title]')).toHaveText('30 минут чтения');
  const visibleActions = page.locator('.sever2-home-now-actions button:visible');
  await expect(visibleActions).toHaveCount(1);
  await expect(visibleActions).toContainText('Открыть привычки');
  await visibleActions.click();
  await expect(page.locator('#habitsView')).toBeVisible();
});

test('v116 closes the day without inventing another action when tasks and habits are done', async ({ page }) => {
  await boot(page, 'complete');
  await expect(page.locator('[data-home-now-title]')).toHaveText('День закрыт');
  await expect(page.locator('[data-home-now-meta]')).toContainText('Отдых тоже часть ритма');
  await expect(page.locator('.sever2-home-now-actions button:visible')).toHaveCount(0);
  await expect(page.locator('[data-home-plan-summary]')).toHaveText('Всё закрыто');
});
