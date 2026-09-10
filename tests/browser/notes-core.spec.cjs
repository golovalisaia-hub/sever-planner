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
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesCore)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await expect(page.locator('#notesView')).toBeVisible();
}

async function quickNote(page, text) {
  const input = page.locator('#notesQuickCaptureInput');
  await input.fill(text);
  await input.press('Enter');
  await expect(page.locator('#noteList')).toContainText(text);
}

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test('Notes core quick capture, filters, sorting and card opening stay functional', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await expect(page.locator('#notesQuickCaptureInput')).toBeVisible();
  await expect(page.locator('#notesCoreSort')).toBeVisible();
  await quickNote(page, 'Первая мысль');
  expect(await page.evaluate(() => window.SeverApp.getState().notes.length)).toBe(1);

  await page.evaluate(() => window.SeverNotes.openNote());
  await expect(page.locator('#noteDialog')).toBeVisible();
  await page.locator('[data-note-type="checklist"]').click();
  await page.locator('#noteTitle').fill('Список дел');
  await page.locator('#noteItemsEditor input[type="text"]').first().fill('Первый пункт');
  await page.locator('#addNoteItem').click();
  await page.locator('#noteItemsEditor input[type="text"]').nth(1).fill('Второй пункт');
  await page.locator('#noteForm .primary').click();

  await expect(page.locator('#noteList')).toContainText('Список дел');
  expect(await page.evaluate(() => window.SeverApp.getState().notes.length)).toBe(2);

  await page.locator('[data-notes-core-filter="checklist"]').click();
  await expect(page.locator('#noteList .note-card')).toHaveCount(1);
  await expect(page.locator('#noteList')).toContainText('Список дел');

  await page.locator('[data-notes-core-filter="all"]').click();
  await page.locator('#notesCoreSort').selectOption('title');
  await expect(page.locator('#noteList .note-card')).toHaveCount(2);
  await expect(page.locator('#noteList .note-card h3').first()).toHaveText('Первая мысль');

  await page.locator('#noteList .note-card h3').first().click();
  await expect(page.locator('#noteDialog')).toBeVisible();
  await expect(page.locator('#noteTitle')).toHaveValue('Первая мысль');
  expect(errors).toEqual([]);
});

test('Notes core remains usable at compact phone widths', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Phone-specific layout check');

  await quickNote(page, 'Короткая запись');
  await quickNote(page, 'Ещё одна запись');
  await expect(page.locator('.notes-core-group-panel')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.evaluate(() => window.SeverNotes.openNote());
  await expect(page.locator('#noteDialog')).toBeVisible();
  const box = await page.locator('#noteDialog').boundingBox();
  const viewport = page.viewportSize();
  expect(box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.height).toBeLessThanOrEqual(viewport.height + 1);
  await expect(page.locator('#noteForm .primary')).toBeVisible();
});
