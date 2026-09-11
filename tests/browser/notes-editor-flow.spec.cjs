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
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesEditorFlow)).toBe('ready');
}

async function openNewNote(page) {
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await page.evaluate(() => window.SeverNotes.openNote());
  await expect(page.locator('#noteDialog')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test('ordinary note draft survives an accidental reload and reopens the editor', async ({ page }) => {
  await openNewNote(page);
  await page.locator('#noteTitle').fill('Черновик после обновления');
  await page.locator('#noteBody').fill('Этот текст не должен потеряться после reload.');
  await page.locator('[data-note-type="checklist"]').click();
  await page.locator('#noteItemsEditor input[type="text"]').first().fill('Первый пункт');

  await expect(page.locator('#noteDraftStatus')).toContainText('Черновик сохранён');
  const before = await page.evaluate(() => JSON.parse(sessionStorage.getItem('sever-note-draft-v1')));
  expect(before.wasOpen).toBe(true);
  expect(before.title).toBe('Черновик после обновления');
  expect(before.items[0].text).toBe('Первый пункт');

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.severNotesEditorFlow === 'ready');
  await expect(page.locator('#notesView')).toBeVisible();
  await expect(page.locator('#noteDialog')).toBeVisible();
  await expect(page.locator('#noteTitle')).toHaveValue('Черновик после обновления');
  await expect(page.locator('#noteBody')).toHaveValue('Этот текст не должен потеряться после reload.');
  await expect(page.locator('#noteItemsEditor input[type="text"]').first()).toHaveValue('Первый пункт');
  await expect(page.locator('#noteDraftStatus')).toContainText('Черновик восстановлен');
});

test('protected note plaintext is never persisted as a recovery draft', async ({ page }) => {
  await openNewNote(page);
  await page.locator('#noteTitle').fill('Секретный заголовок');
  await page.locator('#noteBody').fill('Секретный текст');
  await expect(page.locator('#noteDraftStatus')).toContainText('Черновик сохранён');
  expect(await page.evaluate(() => Boolean(sessionStorage.getItem('sever-note-draft-v1')))).toBe(true);

  await page.locator('#noteProtected').check();
  await expect(page.locator('#noteDraftStatus')).toContainText('черновик не хранится');
  expect(await page.evaluate(() => sessionStorage.getItem('sever-note-draft-v1'))).toBeNull();

  await page.locator('#noteTitle').fill('Ещё один секрет');
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => sessionStorage.getItem('sever-note-draft-v1'))).toBeNull();
});

test('closing the editor normally keeps the draft available but does not auto-reopen it', async ({ page }) => {
  await openNewNote(page);
  await page.locator('#noteTitle').fill('Вернуться позже');
  await expect(page.locator('#noteDraftStatus')).toContainText('Черновик сохранён');
  await page.locator('#noteDialog [data-close="noteDialog"]').click();
  await expect(page.locator('#noteDialog')).toBeHidden();
  const closedDraft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('sever-note-draft-v1')));
  expect(closedDraft.wasOpen).toBe(false);

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.severNotesEditorFlow === 'ready');
  await expect(page.locator('#noteDialog')).toBeHidden();

  await openNewNote(page);
  await expect(page.locator('#noteTitle')).toHaveValue('Вернуться позже');
});
