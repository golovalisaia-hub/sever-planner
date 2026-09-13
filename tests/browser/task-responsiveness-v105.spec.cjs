const { test, expect } = require('@playwright/test');

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    if (localStorage.getItem('sever-anonymous-state-v1')) return;
    const now = Date.now();
    const date = new Date();
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tourSeen: true,
      tasks: [{
        id: 'task-v105', title: 'Проверка отклика', date: today, time: '', duration: null,
        category: 'Личное', priority: false, challenge: false, completed: false,
        createdAt: now, updatedAt: now
      }],
      notes: [{
        id: 'note-v105', title: 'Тестовая заметка', body: 'Состояние заметки не должно пересобираться.',
        kind: 'text', items: [], done: false, protected: false, folderId: '',
        createdAt: now, updatedAt: now
      }],
      folders: [],
      habits: [{ id: 'habit-v105', title: 'Тестовая привычка', createdAt: now, updatedAt: now }],
      checks: { 'habit-v105': [] },
      taskMemory: [],
      profile: { name: '' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes);
  await expect(page.locator('#todayTasks .task')).toHaveCount(1);
  await expect(page.locator('.note-card[data-note-id="note-v105"]')).toHaveCount(1);
  await expect(page.locator('#habitList .habit')).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test('task completion and Undo keep unrelated Notes and Habits DOM stable and persist across reload', async ({ page }) => {
  await page.evaluate(() => {
    window.__v105NoteCard = document.querySelector('.note-card[data-note-id="note-v105"]');
    window.__v105HabitCard = document.querySelector('#habitList .habit');
  });

  const check = page.locator('#todayTasks .task .check');
  await check.click();

  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'task-v105')?.completed)).toBe(true);
  await expect(page.locator('#dashboardCompletedValue')).toHaveText('1');
  await expect(page.locator('#allDone')).toHaveText('1');
  expect(await page.evaluate(() => document.querySelector('.note-card[data-note-id="note-v105"]') === window.__v105NoteCard)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('#habitList .habit') === window.__v105HabitCard)).toBe(true);

  const undo = page.locator('#toast button');
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'task-v105')?.completed)).toBe(false);
  await expect(page.locator('#dashboardCompletedValue')).toHaveText('0');
  expect(await page.evaluate(() => document.querySelector('.note-card[data-note-id="note-v105"]') === window.__v105NoteCard)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('#habitList .habit') === window.__v105HabitCard)).toBe(true);

  await page.locator('#todayTasks .task .check').click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'task-v105')?.completed)).toBe(true);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('sever-anonymous-state-v1'));
    return stored.tasks.find(task => task.id === 'task-v105')?.completed;
  })).toBe(true);

  await page.reload();
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes);
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'task-v105')?.completed)).toBe(true);
  await expect(page.locator('#dashboardCompletedValue')).toHaveText('1');
});
