const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      tasks: [],
      notes: [
        {
          id: 'checklist-polish', folderId: '', title: 'Большой чек-лист', body: '', kind: 'checklist', done: false, protected: false,
          items: [
            { id: '1', text: 'Первый пункт', done: false },
            { id: '2', text: 'Второй пункт', done: false },
            { id: '3', text: 'Третий пункт', done: false },
            { id: '4', text: 'Четвёртый пункт', done: false },
            { id: '5', text: 'Пятый пункт', done: false }
          ], createdAt: now - 1000, updatedAt: now - 1000
        },
        {
          id: 'text-polish', folderId: '', title: 'Длинная заметка',
          body: 'Это длинная заметка для проверки раскрытия. '.repeat(12),
          kind: 'text', items: [], done: false, protected: false, createdAt: now, updatedAt: now
        }
      ],
      folders: [], habits: [], checks: {}, taskMemory: [], profile: { name: '' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }, onboarded: true
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesPolish)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await expect(page.locator('#notesView')).toBeVisible();
}

test.beforeEach(async ({ page }) => { await seed(page); });

test('checklist preview expands, collapses and bulk completion is clear', async ({ page }) => {
  const card = page.locator('#noteList .note-card').filter({ hasText: 'Большой чек-лист' });
  const toggle = card.locator('.notes-core-more-items');
  await expect(toggle).toContainText('Ещё 3');
  await expect(card.locator('.note-check:visible')).toHaveCount(2);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.note-check:visible')).toHaveCount(5);
  await expect(toggle).toContainText('Свернуть');

  const bulk = card.locator('.notes-polish-bulk-action');
  await expect(bulk).toContainText('Выполнить все');
  await bulk.click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().notes.find(note => note.id === 'checklist-polish').items.every(item => item.done))).toBe(true);
});

test('long text preview expands without opening the editor', async ({ page }) => {
  const card = page.locator('#noteList .note-card').filter({ hasText: 'Длинная заметка' });
  const toggle = card.locator('.notes-polish-body-toggle');
  await expect(toggle).toContainText('Показать полностью');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card).toHaveClass(/notes-polish-body-expanded/);
  await expect(page.locator('#noteDialog')).not.toBeVisible();
  await toggle.click();
  await expect(toggle).toContainText('Показать полностью');
});

test('card opens editor while three-dot action remains compact', async ({ page }, info) => {
  const card = page.locator('#noteList .note-card').filter({ hasText: 'Большой чек-лист' });
  await card.locator('.notes-org-action').click();
  const dialog = page.locator('#notesActionDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.notes-org-sheet-actions button')).toHaveCount(3);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box.width).toBeLessThanOrEqual(Math.min(390, viewport.width - 18));
  expect(box.height).toBeLessThan(360);
  await dialog.locator('.notes-org-sheet-cancel').click();

  await card.click({ position: { x: 24, y: 24 } });
  await expect(page.locator('#noteDialog')).toBeVisible();
  if (info.project.name !== 'desktop') {
    const actionSize = await card.locator('.notes-org-action').evaluate(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
    expect(actionSize.w).toBeGreaterThanOrEqual(40);
    expect(actionSize.h).toBeGreaterThanOrEqual(40);
  }
});

test('notes stay readable and overflow-free in all three themes', async ({ page }) => {
  for (const theme of ['light', 'motion', 'black']) {
    await page.evaluate(value => {
      localStorage.setItem('sever-theme', value);
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.waitForTimeout(40);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const cards = page.locator('#noteList .note-card');
    await expect(cards).toHaveCount(2);
    const radius = await cards.first().evaluate(el => getComputedStyle(el).borderRadius);
    expect(parseFloat(radius)).toBeGreaterThanOrEqual(14);
  }
});
