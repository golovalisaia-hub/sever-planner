const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true },
      onboarded: true
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severCreateFlow)).toBe('ready');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severHomeFocus)).toBe('ready');
}

function createButton(page, projectName) {
  return page.locator(projectName === 'desktop' ? '#globalAddBtn' : '#mobileCreateBtn');
}

async function onlyView(page, view) {
  await expect.poll(() => page.locator('.view').evaluateAll(views => views.filter(node => getComputedStyle(node).display !== 'none').map(node => node.id))).toEqual([`${view}View`]);
}

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test('Home keeps the primary task flow stable', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await onlyView(page, 'today');

  await createButton(page, info.project.name).click();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await page.locator('#quickCaptureInput').fill('Проверка главной страницы');
  await page.locator('#quickCaptureForm button[type="submit"]').click();

  const homeTask = page.locator('#sever2HomeTopTasks .sever2-home-focus-task').filter({ hasText: 'Проверка главной страницы' });
  await expect(homeTask).toBeVisible();
  expect(await page.evaluate(() => window.SeverApp.getState().tasks.length)).toBe(1);
  await homeTask.locator('.sever2-home-focus-check').click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks[0].completed)).toBe(true);
  await expect(homeTask).toHaveCount(0);
  await onlyView(page, 'today');
  expect(errors).toEqual([]);
});

test('Notes create, edit, checklist and search stay functional', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await onlyView(page, 'notes');

  if (info.project.name === 'desktop') {
    await page.locator('#openNote').click();
  } else {
    await createButton(page, info.project.name).click();
    await expect(page.locator('#quickAddDialog')).toBeVisible();
    await page.locator('#quickAddNote').click();
  }
  await expect(page.locator('#noteDialog')).toBeVisible();
  await page.locator('#noteTitle').fill('Проверка заметок');
  await page.locator('#noteBody').fill('Текст для поиска и сохранения');
  await page.locator('#noteForm .primary').click();

  await expect(page.locator('#noteList')).toContainText('Проверка заметок');
  expect(await page.evaluate(() => window.SeverApp.getState().notes.length)).toBe(1);

  await page.locator('#noteList .note-edit').click();
  await page.locator('[data-note-type="checklist"]').click();
  const itemInputs = page.locator('#noteItemsEditor input[type="text"]');
  await itemInputs.first().fill('Первый пункт');
  await page.locator('#addNoteItem').click();
  await itemInputs.nth(1).fill('Второй пункт');
  await page.locator('#noteForm .primary').click();

  expect(await page.evaluate(() => window.SeverApp.getState().notes[0].items.length)).toBe(2);
  await page.locator('#noteList .note-check input').first().check();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().notes[0].items[0].done)).toBe(true);

  await page.locator('#noteSearch').fill('Второй пункт');
  await expect(page.locator('#noteList .note-card')).toHaveCount(1);
  await expect(page.locator('#noteList')).toContainText('Проверка заметок');
  await onlyView(page, 'notes');
  expect(errors).toEqual([]);
});

test('Create child editors go Back to the same Create menu instead of dropping to the page', async ({ page }, info) => {
  const routes = [
    ['#quickAddTask', '#taskDialog'],
    ['#quickAddNote', '#noteDialog'],
    ['#quickAddFolder', '#folderDialog'],
    ['#quickAddHabit', '#habitDialog']
  ];

  for (const [trigger, childSelector] of routes) {
    await createButton(page, info.project.name).click();
    await expect(page.locator('#quickAddDialog')).toBeVisible();
    await page.locator(trigger).click();
    const child = page.locator(childSelector);
    await expect(child).toBeVisible();
    const close = child.locator(`[data-close="${childSelector.slice(1)}"]`).first();
    await expect(close).toHaveAttribute('aria-label', 'Назад к меню «Создать»');
    await close.click();
    await expect(child).toBeHidden();
    await expect(page.locator('#quickAddDialog')).toBeVisible();
    await page.locator('[data-close="quickAddDialog"]').first().click();
    await expect(page.locator('#quickAddDialog')).toBeHidden();
  }

  await createButton(page, info.project.name).click();
  await page.locator('#quickAddTask').click();
  await expect(page.locator('#taskDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#taskDialog')).toBeHidden();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await page.locator('[data-close="quickAddDialog"]').first().click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('phone Notes keeps Create as a real Back stack over the Notes page', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Phone-only Create flow');
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await onlyView(page, 'notes');

  await page.locator('#mobileCreateBtn').click();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await page.locator('#quickAddNote').click();
  await expect(page.locator('#noteDialog')).toBeVisible();
  await page.locator('[data-close="noteDialog"]').first().click();
  await expect(page.locator('#noteDialog')).toBeHidden();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await onlyView(page, 'notes');

  await page.locator('#quickAddFolder').click();
  await expect(page.locator('#folderDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#folderDialog')).toBeHidden();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await page.locator('[data-close="quickAddDialog"]').first().click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await onlyView(page, 'notes');
});
