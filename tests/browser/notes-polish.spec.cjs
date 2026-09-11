const { test, expect } = require('@playwright/test');

async function seed(page, theme = 'light') {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(selectedTheme => {
    const now = Date.now();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      tasks: [], folders: [], habits: [], checks: {}, taskMemory: [], focusSessions: [],
      notes: [
        {
          id: 'long-checklist', folderId: '', title: 'Большой список', body: '', kind: 'checklist', protected: false,
          items: Array.from({ length: 6 }, (_, index) => ({ id: `step-${index + 1}`, text: `Пункт ${index + 1}`, done: index === 0 })),
          done: false, createdAt: now - 1000, updatedAt: now
        },
        { id: 'plain-note', folderId: '', title: 'Обычная заметка', body: 'Короткий текст', kind: 'text', items: [], done: false, protected: false, createdAt: now - 2000, updatedAt: now - 1000 }
      ],
      profile: { name: '' },
      appearance: { theme: selectedTheme, animations: 'on', reduceEffects: false },
      stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true },
      onboarded: true
    }));
    localStorage.setItem('sever-theme', selectedTheme);
  }, theme);
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesPolish)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await expect(page.locator('#notesView')).toBeVisible();
}

test('long checklist expands, collapses and keeps item controls functional', async ({ page }) => {
  await seed(page);
  const card = page.locator('#noteList .note-card').filter({ hasText: 'Большой список' });
  const expand = card.locator('.notes-polish-expand');
  await expect(expand).toContainText('Показать ещё 4');
  await expect(card.locator('.note-check').nth(2)).toBeHidden();
  await expect(card.locator('.note-card-actions .note-toggle-all')).toHaveCount(0);
  await expect(card.locator('.notes-polish-checklist-tools .note-toggle-all')).toBeHidden();

  await expand.click();
  await expect(expand).toContainText('Свернуть');
  await expect(card.locator('.note-check').nth(2)).toBeVisible();
  await expect(card.locator('.notes-polish-checklist-tools .note-toggle-all')).toBeVisible();

  await card.locator('.note-check').nth(2).locator('input').check();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().notes.find(note => note.id === 'long-checklist').items[2].done)).toBe(true);

  const refreshedCard = page.locator('#noteList .note-card').filter({ hasText: 'Большой список' });
  await refreshedCard.locator('.notes-polish-expand').click();
  await expect(refreshedCard.locator('.note-check').nth(2)).toBeVisible();
  await refreshedCard.locator('.notes-polish-expand').click();
  await expect(refreshedCard.locator('.note-check').nth(2)).toBeHidden();
});

test('mobile action targets are comfortable and action sheet stays compact', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Touch target check');
  await seed(page);
  const card = page.locator('#noteList .note-card').filter({ hasText: 'Большой список' });
  const more = card.locator('.notes-org-action');
  const edit = card.locator('.note-edit');
  for (const target of [more, edit]) {
    const box = await target.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(43);
    expect(box.height).toBeGreaterThanOrEqual(43);
  }
  await more.click();
  await expect(page.locator('#notesActionDialog')).toBeVisible();
  const sheet = await page.locator('#notesActionDialog .notes-org-sheet-card').boundingBox();
  expect(sheet.height).toBeLessThan(330);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

for (const theme of ['light', 'motion', 'black']) {
  test(`Notes remain separated and readable in ${theme} theme`, async ({ page }) => {
    await seed(page, theme);
    const cards = page.locator('#noteList .note-card.notes-polish-card');
    await expect(cards).toHaveCount(2);
    const first = cards.first();
    const radius = await first.evaluate(element => getComputedStyle(element).borderRadius);
    expect(parseFloat(radius)).toBeGreaterThanOrEqual(16);
    const panel = page.locator('.notes-core-group-panel').first();
    expect(await panel.evaluate(element => getComputedStyle(element).display)).toBe('grid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}
