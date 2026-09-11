const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

function emptyState() {
  return {
    version: 11, onboarded: true, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
    profile: { name: 'QA' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
    focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
    security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
  };
}

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.SEVER_SUPABASE_CONFIG={};window.SEVER_CLOUD_ENABLED=false;'
  }));
  await page.addInitScript(state => {
    localStorage.clear();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify(state));
    localStorage.setItem('sever-theme', 'light');
  }, emptyState());
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes && document.documentElement.dataset.severHomeCore === 'ready');
  await expect.poll(() => page.evaluate(() => Boolean(window.SeverCloudReady))).toBe(true);
}

async function openCreate(page) {
  const mobile = page.locator('#mobileCreateBtn');
  if (await mobile.isVisible()) await mobile.click();
  else await page.locator('#globalAddBtn').click();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await expect(page.locator('#quickCaptureInput')).toBeFocused();
}

async function onlyView(page, name) {
  await expect.poll(() => page.locator('.view').evaluateAll(views => views
    .filter(view => getComputedStyle(view).display !== 'none')
    .map(view => view.id))).toEqual([`${name}View`]);
}

async function noOverflow(page) {
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
  expect(overflow).toBeLessThanOrEqual(1);
}

async function createQuickTask(page, title) {
  await page.evaluate(() => window.SeverApp.switchView('today'));
  await openCreate(page);
  await page.locator('#quickCaptureInput').fill(title);
  const started = Date.now();
  await page.locator('#quickCaptureForm button[type="submit"]').click();
  await expect(page.locator('#todayTasks')).toContainText(title);
  expect(Date.now() - started).toBeLessThan(2000);
  return page.evaluate(value => window.SeverApp.getState().tasks.find(task => task.title === value)?.id || '', title);
}

async function quickNote(page, title) {
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await expect(page.locator('#notesQuickCaptureInput')).toBeVisible();
  const started = Date.now();
  await page.locator('#notesQuickCaptureInput').fill(title);
  await page.locator('#notesQuickCaptureInput').press('Enter');
  await expect(page.locator('#noteList')).toContainText(title);
  expect(Date.now() - started).toBeLessThan(2000);
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('experienced user can hammer primary flows without stale UI or duplicate writes', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  // Repeated navigation should never leave two views visible or overflow the page.
  for (let round = 0; round < 3; round++) {
    for (const view of ['today', 'calendar', 'timer', 'notes', 'habits', 'progress', 'money', 'settings', 'today']) {
      await page.evaluate(value => window.SeverApp.switchView(value), view);
      await onlyView(page, view);
      await noOverflow(page);
    }
  }

  // Create a normal task and verify immediate reaction.
  const taskTitle = `QA задача ${info.project.name}`;
  const taskId = await createQuickTask(page, taskTitle);
  expect(taskId).toBeTruthy();

  // A fast double-click on submit must not duplicate a task.
  await openCreate(page);
  const doubleTitle = `QA double ${info.project.name}`;
  await page.locator('#quickCaptureInput').fill(doubleTitle);
  await page.locator('#quickCaptureForm button[type="submit"]').dblclick();
  await expect(page.locator('#quickAddDialog')).toBeHidden();
  await expect.poll(() => page.evaluate(value => window.SeverApp.getState().tasks.filter(task => task.title === value).length, doubleTitle)).toBe(1);

  // Edit through the user-facing action dialog.
  const taskCard = page.locator('#todayTasks .task').filter({ hasText: taskTitle });
  await taskCard.locator('.task-open').click();
  await expect(page.locator('#taskActionDialog')).toBeVisible();
  await page.locator('#taskActionEdit').click();
  const editedTitle = `${taskTitle} изменена`;
  await page.locator('#taskTitle').fill(editedTitle);
  await page.locator('#taskForm .primary').click();
  await expect(page.locator('#todayTasks')).toContainText(editedTitle);
  await expect(page.locator('#todayTasks')).not.toContainText(taskTitle + '$');

  // Complete and undo: the same entity should return immediately.
  const editedCard = page.locator('#todayTasks .task').filter({ hasText: editedTitle });
  await editedCard.locator('.task-open').click();
  await page.locator('#taskActionComplete').click();
  await expect.poll(() => page.evaluate(id => window.SeverApp.getState().tasks.find(task => task.id === id)?.completed, taskId)).toBe(true);
  await expect(page.locator('#toast button')).toHaveText('Отменить');
  await page.locator('#toast button').click();
  await expect.poll(() => page.evaluate(id => window.SeverApp.getState().tasks.find(task => task.id === id)?.completed, taskId)).toBe(false);

  // Delete and undo must restore the exact id rather than create a copy.
  await page.locator('#todayTasks .task').filter({ hasText: editedTitle }).locator('.task-open').click();
  await page.locator('#taskActionDelete').click();
  await expect.poll(() => page.evaluate(id => window.SeverApp.getState().tasks.some(task => task.id === id), taskId)).toBe(false);
  await page.locator('#toast button').click();
  await expect.poll(() => page.evaluate(id => window.SeverApp.getState().tasks.some(task => task.id === id), taskId)).toBe(true);

  // Notes: quick capture, full checklist, complete-all, delete and undo.
  const noteTitle = `QA заметка ${info.project.name}`;
  await quickNote(page, noteTitle);
  await page.locator('#noteList .note-card').filter({ hasText: noteTitle }).locator('.note-edit').click();
  await page.locator('#noteBody').fill('Текст после редактирования');
  await page.locator('#noteForm .primary').click();
  await expect(page.locator('#noteList .note-card').filter({ hasText: noteTitle })).toContainText('Текст после редактирования');

  await page.locator('.notes-core-expand').click();
  await page.locator('[data-note-type="checklist"]').click();
  const checklistTitle = `QA чеклист ${info.project.name}`;
  await page.locator('#noteTitle').fill(checklistTitle);
  await page.locator('#noteItemsEditor input[type="text"]').first().fill('Первый пункт');
  await page.locator('#addNoteItem').click();
  await page.locator('#noteItemsEditor input[type="text"]').nth(1).fill('Второй пункт');
  await page.locator('#noteForm .primary').click();
  const checklistCard = page.locator('#noteList .note-card').filter({ hasText: checklistTitle });
  await expect(checklistCard).toBeVisible();
  await checklistCard.locator('.note-toggle-all').click();
  await expect.poll(() => page.evaluate(title => {
    const note = window.SeverApp.getState().notes.find(item => item.title === title);
    return note?.items?.every(item => item.done) || false;
  }, checklistTitle)).toBe(true);

  await page.locator('#noteList .note-card').filter({ hasText: noteTitle }).locator('.note-edit').click();
  const noteId = await page.locator('#noteId').inputValue();
  await page.locator('#deleteNote').click();
  await expect.poll(() => page.evaluate(id => window.SeverApp.getState().notes.some(note => note.id === id), noteId)).toBe(false);
  await page.locator('#toast button').click();
  await expect.poll(() => page.evaluate(id => window.SeverApp.getState().notes.some(note => note.id === id), noteId)).toBe(true);

  // Habit: create, toggle, undo, delete, undo.
  await page.evaluate(() => window.SeverApp.switchView('habits'));
  await page.locator('#openHabit').click();
  const habitTitle = `QA привычка ${info.project.name}`;
  await page.locator('#habitTitle').fill(habitTitle);
  await page.locator('#habitSubmit').click();
  const habit = page.locator('#habitList .habit').filter({ hasText: habitTitle });
  await expect(habit).toBeVisible();
  const habitId = await page.evaluate(title => window.SeverApp.getState().habits.find(item => item.title === title)?.id || '', habitTitle);
  await habit.locator('.habit-day.today').click();
  await expect(habit.locator('.habit-day.today')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#toast button').click();
  await expect(habit.locator('.habit-day.today')).toHaveAttribute('aria-pressed', 'false');
  await habit.locator('.habit-edit').click();
  await page.locator('#deleteHabit').click();
  await page.locator('#confirmHabitDelete').click();
  await expect.poll(() => page.evaluate(id => window.SeverApp.getState().habits.some(item => item.id === id), habitId)).toBe(false);
  await page.locator('#toast button').click();
  await expect.poll(() => page.evaluate(id => window.SeverApp.getState().habits.some(item => item.id === id), habitId)).toBe(true);

  // Money: create, schedule reminders, delete with explicit confirmation, no orphan reminders.
  await page.evaluate(() => window.SeverApp.switchView('money'));
  const moneyTitle = `QA цель ${info.project.name}`;
  await page.locator('[data-money-create="goal"]').click();
  await page.locator('#moneyItemName').fill(moneyTitle);
  await page.locator('#moneyItemTarget').fill('12000');
  await page.locator('#moneyItemBudget').fill('6000');
  await page.locator('#moneyItemForm button.primary').click();
  const moneyCard = page.locator('.money-card').filter({ hasText: moneyTitle });
  await expect(moneyCard).toBeVisible();
  await moneyCard.locator('.money-card-actions button').filter({ hasText: 'В календарь' }).click();
  await page.locator('#moneyScheduleConfirm').click();
  const generatedCount = await page.evaluate(title => {
    const state = window.SeverApp.getState();
    const item = state.profile.money.items.find(row => row.title === title);
    return item?.calendarTaskIds?.length || 0;
  }, moneyTitle);
  expect(generatedCount).toBeGreaterThan(0);
  await moneyCard.locator('.money-icon-action').click();
  await page.locator('#moneyItemDelete').click();
  await expect(page.locator('#moneyItemDelete')).toHaveText('Нажми ещё раз');
  await page.locator('#moneyItemDelete').click();
  await expect(moneyCard).toHaveCount(0);
  expect(await page.evaluate(() => window.SeverApp.getState().tasks.filter(task => task.title.includes('QA цель')).length)).toBe(0);

  // Theme and guide changes must stay usable and preserve one-page geometry.
  await page.evaluate(() => window.SeverApp.switchView('settings'));
  for (const theme of ['light', 'motion', 'black']) {
    await page.locator(`[data-sever-theme="${theme}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await noOverflow(page);
  }
  await page.locator('#settingsGuide').click();
  await expect(page.locator('#tourDialog')).toBeVisible();
  await page.locator('#tourSkip').click();
  await expect(page.locator('#tourDialog')).toBeHidden();

  // AI shell should open/close without moving content outside the viewport.
  await page.locator('#severAiOpen').click();
  await expect(page.locator('#severAiPanel')).toBeVisible();
  await expect(page.locator('#severAiInput')).toBeVisible();
  await noOverflow(page);
  await page.locator('#severAiClose').click();
  await expect(page.locator('#severAiPanel')).toBeHidden();

  // Reload: state and selected theme survive without corrupting planner data.
  const beforeReload = await page.evaluate(() => ({
    taskIds: window.SeverApp.getState().tasks.map(task => task.id).sort(),
    noteIds: window.SeverApp.getState().notes.map(note => note.id).sort(),
    habitIds: window.SeverApp.getState().habits.map(habit => habit.id).sort(),
    theme: document.documentElement.dataset.theme
  }));
  await page.reload();
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severHomeCore === 'ready');
  const afterReload = await page.evaluate(() => ({
    taskIds: window.SeverApp.getState().tasks.map(task => task.id).sort(),
    noteIds: window.SeverApp.getState().notes.map(note => note.id).sort(),
    habitIds: window.SeverApp.getState().habits.map(habit => habit.id).sort(),
    theme: document.documentElement.dataset.theme
  }));
  expect(afterReload).toEqual(beforeReload);
  expect(errors).toEqual([]);
});

test('linked one-minute focus completes exactly once and returns home', async ({ page }) => {
  await page.clock.install();
  const today = await page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
  await page.evaluate(async date => {
    const state = window.SeverApp.getState();
    const now = Date.now();
    state.tasks.push({ id: 'qa-focus-task', title: 'QA фокус', date, time: '', duration: 1, category: 'Личное', priority: true, challenge: false, completed: false, createdAt: now, updatedAt: now });
    await window.SeverApp.persist();
    window.SeverApp.render();
  }, today);
  await page.evaluate(() => window.SeverApp.switchView('today'));
  await page.locator('#sever2HomeCore [data-home-action="focus"]').click();
  await onlyView(page, 'timer');
  await page.clock.runFor(61000);
  await onlyView(page, 'today');
  const result = await page.evaluate(() => ({
    task: window.SeverApp.getState().tasks.find(task => task.id === 'qa-focus-task'),
    sessions: window.SeverApp.getState().focusSessions.filter(session => session.taskId === 'qa-focus-task')
  }));
  expect(result.task.completed).toBe(true);
  expect(result.sessions).toHaveLength(1);
  await page.clock.runFor(3000);
  expect(await page.evaluate(() => window.SeverApp.getState().focusSessions.filter(session => session.taskId === 'qa-focus-task').length)).toBe(1);
});
