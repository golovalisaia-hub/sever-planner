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

test('checklist preview shows three rows and More expands inline without opening the editor', async ({ page }) => {
  const card = page.locator('#noteList .note-card').filter({ hasText: 'Большой чек-лист' });
  const more = card.locator('.notes-core-more-items');
  await expect(more).toContainText('Ещё 2');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('.note-check:visible')).toHaveCount(3);

  await more.click();
  await expect(page.locator('#noteDialog')).toBeHidden();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(more).toContainText('Свернуть');
  await expect(card).toHaveClass(/notes-polish-checklist-expanded/);
  await expect(card.locator('.note-check:visible')).toHaveCount(5);

  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('.note-check:visible')).toHaveCount(3);
});

test('bulk completion remains explicit while the preview stays compact', async ({ page }) => {
  const card = page.locator('#noteList .note-card').filter({ hasText: 'Большой чек-лист' });
  const bulk = card.locator('.notes-polish-bulk-action');
  await expect(bulk).toContainText('Выполнить все');
  await bulk.click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().notes.find(note => note.id === 'checklist-polish').items.every(item => item.done))).toBe(true);
  await expect(card.locator('.note-check:visible')).toHaveCount(3);
});

test('long text preview expands inline with More and never opens the editor', async ({ page }) => {
  const card = page.locator('#noteList .note-card').filter({ hasText: 'Длинная заметка' });
  const toggle = card.locator('.notes-polish-body-toggle');
  await expect(toggle).toContainText('Ещё');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toContainText('Свернуть');
  await expect(card).toHaveClass(/notes-polish-body-expanded/);
  await expect(page.locator('#noteDialog')).toBeHidden();
});

test('phone Notes keeps the compact v94 type selector instead of four permanent filter buttons', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesCompact)).toBe('v94');
  const select = page.locator('#notesCompactType');
  await expect(select).toBeVisible();
  await expect(page.locator('#notesView .notes-core-filters')).toBeHidden();
  const height = await select.evaluate(el => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(44);

  await select.selectOption('checklist');
  await expect(page.locator('#noteList .note-card').filter({ hasText: 'Большой чек-лист' })).toBeVisible();
  await expect(page.locator('#noteList .note-card').filter({ hasText: 'Длинная заметка' })).toHaveCount(0);

  await select.selectOption('all');
  await expect(page.locator('#noteList .note-card')).toHaveCount(2);
});

test('mobile checklist editor uses one scroll flow and actions never cover checklist rows', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop');
  const card = page.locator('#noteList .note-card').filter({ hasText: 'Большой чек-лист' });
  await card.locator('.note-edit').click();
  const dialog = page.locator('#noteDialog');
  await expect(dialog).toBeVisible();
  const last = page.locator('#noteItemsEditor .note-item-editor').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();

  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector('#noteDialog').getBoundingClientRect();
    const editor = document.querySelector('#noteItemsEditor');
    const last = editor.querySelector('.note-item-editor:last-child').getBoundingClientRect();
    const actions = document.querySelector('#noteForm .dialog-actions').getBoundingClientRect();
    const save = document.querySelector('#noteForm .dialog-actions .primary').getBoundingClientRect();
    const overlap = Math.max(0, Math.min(last.bottom, actions.bottom) - Math.max(last.top, actions.top));
    return {
      dialogHeight: dialog.height,
      viewportHeight: innerHeight,
      editorMax: getComputedStyle(editor).maxHeight,
      editorOverflow: getComputedStyle(editor).overflowY,
      actionPosition: getComputedStyle(document.querySelector('#noteForm .dialog-actions')).position,
      overlap,
      saveHeight: save.height,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth
    };
  });
  expect(geometry.dialogHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.editorMax).toBe('none');
  expect(geometry.editorOverflow).toBe('visible');
  expect(geometry.actionPosition).toBe('static');
  expect(geometry.overlap).toBeLessThanOrEqual(1);
  expect(geometry.saveHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
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

  await card.locator('.note-edit').click();
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
    await expect(cards.filter({ hasText: 'Большой чек-лист' }).locator('.note-check:visible')).toHaveCount(3);
    const radius = await cards.first().evaluate(el => getComputedStyle(el).borderRadius);
    expect(parseFloat(radius)).toBeGreaterThanOrEqual(14);
  }
});
