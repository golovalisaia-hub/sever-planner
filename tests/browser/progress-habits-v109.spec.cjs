const { test, expect } = require('@playwright/test');

function iso(offset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    const toIso = offset => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() + offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    const now = Date.now();
    const habitCreated = now - 45 * 86400000;
    const habitA = 'habit-v109-a';
    const habitB = 'habit-v109-b';
    const checksA = [-1,-2,-3,-5,-7,-8,-9,-10,-14,-15,-20,-25].map(toIso);
    const checksB = [0,-2,-4,-6,-8,-12,-16,-18,-22,-28].map(toIso);
    const tasks = [];
    for (let offset = 0; offset > -12; offset -= 1) {
      tasks.push({
        id: `task-v109-${offset}`,
        title: `Задача ${Math.abs(offset) + 1}`,
        date: toIso(offset),
        time: '',
        duration: 20,
        category: 'Личное',
        priority: false,
        challenge: false,
        completed: offset % 3 !== 0,
        completedAt: offset % 3 !== 0 ? now + offset * 86400000 : null,
        createdAt: now + offset * 86400000,
        updatedAt: now
      });
    }
    tasks.push({
      id: 'missed-v109', title: 'ПТД полчаса', date: toIso(-1), time: '', duration: 30,
      category: 'Учёба', priority: false, challenge: false, completed: false,
      completedAt: null, createdAt: now - 86400000, updatedAt: now - 86400000
    });
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tourSeen: true,
      tasks,
      notes: [],
      folders: [],
      habits: [
        { id: habitA, title: 'Python', createdAt: habitCreated, updatedAt: now },
        { id: habitB, title: 'ПДД', createdAt: habitCreated, updatedAt: now }
      ],
      checks: { [habitA]: checksA, [habitB]: checksB },
      taskMemory: [],
      profile: { name: '' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [
        { id: 'focus-now-1', durationMinutes: 35, startedAt: now - 2 * 86400000, completedAt: now - 2 * 86400000, status: 'completed', createdAt: now, updatedAt: now },
        { id: 'focus-now-2', durationMinutes: 25, startedAt: now - 5 * 86400000, completedAt: now - 5 * 86400000, status: 'completed', createdAt: now, updatedAt: now },
        { id: 'focus-prev', durationMinutes: 20, startedAt: now - 9 * 86400000, completedAt: now - 9 * 86400000, status: 'completed', createdAt: now, updatedAt: now }
      ],
      stats: { focusMs: 80 * 60000, sessions: 3 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severProgressHabits === 'ready');
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test('Progress shows dense 30-day task, habit, streak and focus history without horizontal overflow', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('progress'));

  const summary = page.locator('#sever109ProgressSummary');
  await expect(summary).toBeVisible();
  await expect(summary.locator('.sever109-progress-card')).toHaveCount(4);
  await expect(summary.locator('[data-metric="tasks"] b')).toContainText('%');
  await expect(summary.locator('[data-metric="habits"] b')).toContainText('%');
  await expect(summary.locator('[data-metric="streak"] small')).toContainText('Текущая');
  await expect(summary.locator('[data-metric="focus"] b')).not.toHaveText('0м');

  const habitProgress = page.locator('#sever109HabitProgress');
  await expect(habitProgress).toBeVisible();
  await expect(habitProgress.locator('.sever109-habit-progress-row')).toHaveCount(2);
  await expect(habitProgress.locator('.sever109-habit-progress-row').first().locator('.sever109-habit-dot')).toHaveCount(30);
  await expect(habitProgress).toContainText('регулярности');

  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.width + 1);
});

test('Habits keeps saved previous weeks visible and returns to the editable current week', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('habits'));
  const bar = page.locator('#sever109HabitHistoryBar');
  await expect(bar).toBeVisible();
  await expect(page.locator('#habitList .sever109-habit-metrics')).toHaveCount(2);
  await expect(page.locator('#habitList .sever109-habit-metric.history').first()).toContainText('%');

  const currentLabel = await page.locator('#sever109HabitWeekLabel').textContent();
  await bar.locator('[data-week="prev"]').click();
  await expect(page.locator('#sever109HabitWeekLabel')).not.toHaveText(currentLabel || '');
  await expect(page.locator('#habitList .sever109-history-week')).toHaveCount(2);
  await expect(page.locator('#habitList .sever109-history-week .habit-day.done').first()).toBeVisible();
  await expect(page.locator('#habitList .habit-help').first()).toContainText('история сохранена');

  await bar.locator('[data-week="current"]').click();
  await expect(page.locator('#sever109HabitWeekLabel')).toContainText('Текущая');
  await expect(page.locator('#habitList .sever109-history-week')).toHaveCount(0);
});

test('Missed task never looks completed before the user completes it, and Undo restores the pending state', async ({ page }) => {
  const block = page.locator('#missedTasksBlock');
  await expect(block).toBeVisible();
  const missed = block.locator('.missed-task').filter({ hasText: 'ПТД полчаса' });
  const check = missed.locator('.missed-check');
  await expect(check).toHaveText('');
  await expect(check).toHaveAttribute('aria-pressed', 'false');
  await expect(check).toHaveAttribute('data-state', 'pending');

  await check.click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'missed-v109')?.completed)).toBe(true);

  const undo = page.locator('#toast button');
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'missed-v109')?.completed)).toBe(false);
  await expect(block).toBeVisible();
  await expect(block.locator('.missed-task').filter({ hasText: 'ПТД полчаса' }).locator('.missed-check')).toHaveText('');
});

test('Calendar day dialog refreshes after toggling a historical task instead of keeping a stale checkmark', async ({ page }) => {
  const yesterday = iso(-1);
  await page.evaluate(() => window.SeverApp.switchView('calendar'));
  const cell = page.locator(`#calendar > .day[data-sever-date="${yesterday}"]`);
  await expect(cell).toBeVisible();
  await cell.click();

  const dialog = page.locator('#dayDialog');
  await expect(dialog).toBeVisible();
  const row = dialog.locator('#dayTaskList .task').filter({ hasText: 'ПТД полчаса' });
  await expect(row).not.toHaveClass(/done/);

  await row.locator('.check').click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'missed-v109')?.completed)).toBe(true);
  await expect(dialog.locator('#dayTaskList .task').filter({ hasText: 'ПТД полчаса' })).toHaveClass(/done/);

  await dialog.locator('#dayTaskList .task').filter({ hasText: 'ПТД полчаса' }).locator('.check').click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'missed-v109')?.completed)).toBe(false);
  await expect(dialog.locator('#dayTaskList .task').filter({ hasText: 'ПТД полчаса' })).not.toHaveClass(/done/);
});