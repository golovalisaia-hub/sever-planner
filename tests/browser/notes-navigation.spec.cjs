const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }, onboarded: true
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes && window.SeverNotesOrganization);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesNavigation)).toBe('ready');
  await page.evaluate(async () => {
    const state = window.SeverApp.getState();
    const now = Date.now();
    state.folders = [{ id: 'work', name: 'Работа', createdAt: now, updatedAt: now }];
    state.notes = [
      { id: 'work-note', folderId: 'work', title: 'Рабочая идея', body: 'SEVER', kind: 'text', items: [], done: false, protected: false, createdAt: now, updatedAt: now },
      { id: 'personal-note', folderId: '', title: 'Личное', body: 'Дом', kind: 'text', items: [], done: false, protected: false, createdAt: now - 1, updatedAt: now - 1 }
    ];
    state.profile.noteOrganization = { v: 1, notes: {
      'work-note': { pinned: false, tags: ['Идеи'] },
      'personal-note': { pinned: false, tags: ['Личное'] }
    } };
    await save();
    window.SeverNotes.render();
    window.SeverApp.switchView('notes');
  });
  await expect(page.locator('#notesNavigationScopes')).toBeVisible();
}

test.beforeEach(async ({ page }) => seed(page));

test('folder and tag sheets replace long rails without changing filtering behavior', async ({ page }) => {
  await expect(page.locator('#folderTabs')).toBeHidden();
  await expect(page.locator('#notesOrganizationTags')).toBeHidden();
  await expect(page.locator('[data-notes-scope="folder"] b')).toHaveText('Все');

  await page.locator('[data-notes-scope="folder"]').click();
  await expect(page.locator('#notesNavigatorDialog')).toBeVisible();
  await expect(page.locator('#notesNavigatorTitle')).toHaveText('Папки');
  await page.locator('.notes-navigation-option', { hasText: 'Работа' }).click();
  await expect(page.locator('[data-notes-scope="folder"] b')).toHaveText('Работа');
  await expect(page.locator('#noteList')).toContainText('Рабочая идея');
  await expect(page.locator('#noteList')).not.toContainText('Личное');

  await page.locator('[data-notes-scope="tag"]').click();
  await expect(page.locator('#notesNavigatorTitle')).toHaveText('Теги');
  await page.locator('.notes-navigation-option', { hasText: '#Идеи' }).click();
  await expect(page.locator('[data-notes-scope="tag"] b')).toHaveText('#Идеи');
  await expect(page.locator('[data-notes-scope-reset]')).toBeVisible();

  await page.locator('[data-notes-scope-reset]').click();
  await expect(page.locator('[data-notes-scope="folder"] b')).toHaveText('Все');
  await expect(page.locator('[data-notes-scope="tag"] b')).toHaveText('Теги');
  await expect(page.locator('#noteList')).toContainText('Рабочая идея');
  await expect(page.locator('#noteList')).toContainText('Личное');
});

test('folder sheet keeps creation and management on the existing Notes core', async ({ page }) => {
  await page.locator('[data-notes-scope="folder"]').click();
  await page.locator('#notesNavigatorFooter button', { hasText: 'Новая папка' }).click();
  await expect(page.locator('#folderDialog')).toBeVisible();
  await page.locator('#folderDialog [value="cancel"]').click();

  await page.locator('[data-notes-scope="folder"]').click();
  await page.locator('.notes-navigation-option', { hasText: 'Работа' }).click();
  await page.locator('[data-notes-scope="folder"]').click();
  await expect(page.locator('#notesNavigatorFooter button', { hasText: 'Управлять текущей' })).toBeVisible();
});

test('navigation stays sticky and does not create horizontal overflow', async ({ page }) => {
  const position = await page.locator('#notesNavigationSticky').evaluate(element => getComputedStyle(element).position);
  expect(position).toBe('sticky');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
