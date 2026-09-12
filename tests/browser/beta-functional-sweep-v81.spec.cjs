const { test, expect } = require('@playwright/test');

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function boot(page) {
  const today = isoToday();
  await page.route('**/supabase-config.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.SEVER_SUPABASE_CONFIG={};'
  }));
  await page.addInitScript(seed => {
    if (localStorage.getItem('sever-e2e-beta-seeded-v1') === '1') return;
    const now = Date.now();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks: [
        { id: 'audit-focus', title: 'Аудит фокуса', date: seed, time: '10:00', duration: 1, category: 'Личное', priority: true, challenge: false, completed: false, createdAt: now, updatedAt: now },
        { id: 'audit-inbox', title: 'Разобрать входящую', date: '9999-12-31', time: '', duration: 15, category: 'Работа', priority: false, challenge: false, completed: false, createdAt: now + 1, updatedAt: now + 1 }
      ],
      notes: [], folders: [],
      habits: [{ id: 'audit-habit', title: 'Проверка привычки', createdAt: now, updatedAt: now }],
      checks: { 'audit-habit': [] },
      taskMemory: [],
      profile: { name: 'BETA' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
    localStorage.setItem('sever-e2e-beta-seeded-v1', '1');
  }, today);
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severMoney)).toBe('ready');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severFocusFlow)).toBe('ready');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesPolish)).toBe('ready');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severCloudRecovery)).toBe('ready');
}

async function openCreate(page, projectName) {
  const selector = projectName === 'desktop' ? '#globalAddBtn' : '#mobileCreateBtn';
  await page.locator(selector).click();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
}

async function switchView(page, view) {
  await page.evaluate(target => window.SeverApp.switchView(target), view);
  const selector = view === 'money' ? '#moneyView' : `#${view}View`;
  await expect(page.locator(selector)).toBeVisible();
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('beta journey keeps tasks, focus, calendar, habits, notes, Money and theme persistence coherent', async ({ page }, info) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await switchView(page, 'timer');
  await page.locator('#sever2FocusQueue [data-task-id="audit-focus"] [data-start-focus]').click();
  await expect(page.locator('#activeTimerTask')).toBeVisible();
  await expect(page.locator('#timerTaskTitle')).toHaveText('Аудит фокуса');
  await expect.poll(() => page.evaluate(() => window.SeverApp.getTimerStatus())).toMatch(/^Работает/);
  await page.locator('#completeTimerTask').click();
  await expect(page.locator('#todayView')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(t => t.id === 'audit-focus')?.completed)).toBe(true);
  await expect(page.locator('#toast button')).toHaveText('Отменить');
  await page.locator('#toast button').click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(t => t.id === 'audit-focus')?.completed)).toBe(false);

  await switchView(page, 'calendar');
  await page.locator('.sever2-calendar-modes [data-mode="inbox"]').click();
  await expect(page.locator('#sever2InboxPanel')).toContainText('Разобрать входящую');
  await page.locator('#sever2InboxPanel [data-plan-today]').click();
  const today = isoToday();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(t => t.id === 'audit-inbox')?.date)).toBe(today);

  await switchView(page, 'habits');
  const habitToday = page.locator('#habitList .habit').first().locator('.habit-day.today');
  const habitDate = await habitToday.getAttribute('data-date');
  expect(habitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await habitToday.click();
  await expect(habitToday).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(date => window.SeverApp.getState().checks['audit-habit']?.includes(date), habitDate)).toBe(true);
  await page.waitForTimeout(500);
  await habitToday.click();
  await expect(habitToday).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(date => window.SeverApp.getState().checks['audit-habit']?.includes(date), habitDate)).toBe(false);

  // Create a 4-item checklist through the real Create flow. Three rows stay visible; More expands inline.
  await switchView(page, 'notes');
  await openCreate(page, info.project.name);
  await page.locator('#quickAddNote').click();
  await expect(page.locator('#noteDialog')).toBeVisible();
  await page.locator('#noteTitle').fill('Beta checklist');
  await page.locator('[data-note-type="checklist"]').click();
  let items = page.locator('#noteItemsEditor input[type="text"]');
  await items.first().fill('Первый');
  for (const value of ['Второй', 'Третий', 'Четвёртый']) {
    await page.locator('#addNoteItem').click();
    items = page.locator('#noteItemsEditor input[type="text"]');
    await items.last().fill(value);
  }
  await page.locator('#noteForm .primary').click();
  const noteCard = page.locator('#noteList .note-card').filter({ hasText: 'Beta checklist' });
  await expect(noteCard).toBeVisible();
  await expect(noteCard.locator('.note-check:visible')).toHaveCount(3);
  await expect(noteCard.locator('.notes-core-more-items')).toContainText('Ещё 1');
  await noteCard.locator('.notes-core-more-items').click();
  await expect(page.locator('#noteDialog')).toBeHidden();
  await expect(noteCard.locator('.note-check:visible')).toHaveCount(4);
  await expect(noteCard.locator('.notes-core-more-items')).toContainText('Свернуть');

  await switchView(page, 'money');
  await page.locator('#moneyQuickInput').fill('долг 10000 до декабря');
  await page.locator('#moneyQuickForm button[type="submit"]').click();
  await page.locator('#moneyItemName').fill('Beta debt');
  await page.locator('#moneyItemBudget').fill('2500');
  await page.locator('#moneyItemForm button.primary').click();
  await expect(page.locator('.money-card').filter({ hasText: 'Beta debt' })).toBeVisible();
  await page.locator('.money-card').filter({ hasText: 'Beta debt' }).locator('.money-primary').click();
  await page.locator('#moneyProgressAmount').fill('1000');
  await page.locator('#moneyProgressForm button.primary').click();
  await expect(page.locator('.money-card').filter({ hasText: 'Beta debt' }).locator('.money-card-amount')).toContainText(/9.?000/);

  await switchView(page, 'settings');
  await page.locator('[data-sever-theme="motion"]').click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sever-theme'))).toBe('motion');
  await page.reload();
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severMoney === 'ready');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('motion');
  const persisted = await page.evaluate(() => {
    const s = window.SeverApp.getState();
    const moneyItem = s.profile?.money?.items?.find(item => item.title === 'Beta debt');
    return {
      tasks: s.tasks.map(t => ({ id: t.id, date: t.date, completed: t.completed })),
      noteItems: s.notes.find(n => n.title === 'Beta checklist')?.items?.length,
      moneyRemaining: moneyItem ? moneyItem.targetAmount - moneyItem.currentAmount : null,
      habitDates: s.checks['audit-habit'] || []
    };
  });
  expect(persisted.tasks.find(t => t.id === 'audit-focus')?.completed).toBe(false);
  expect(persisted.tasks.find(t => t.id === 'audit-inbox')?.date).toBe(today);
  expect(persisted.noteItems).toBe(4);
  expect(persisted.moneyRemaining).toBe(9000);
  expect(persisted.habitDates).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('every primary page stays usable without horizontal overflow in all three themes', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const views = ['today', 'calendar', 'timer', 'notes', 'money', 'progress', 'habits', 'settings'];

  for (const theme of ['light', 'motion', 'black']) {
    await page.evaluate(value => {
      localStorage.setItem('sever-theme', value);
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const view of views) {
      await switchView(page, view);
      const geometry = await page.evaluate(() => ({
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        width: document.documentElement.scrollWidth,
        viewport: innerWidth
      }));
      expect(geometry.overflow, `${theme}/${view} overflow ${geometry.width}-${geometry.viewport}`).toBeLessThanOrEqual(1);
    }
  }
  expect(pageErrors).toEqual([]);
});