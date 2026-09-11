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
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes && window.SeverNotesOrganization);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesOrganization)).toBe('ready');
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

test('pinning, tags and tag filters stay synchronized with planner state', async ({ page }) => {
  await quickNote(page, 'Идея для SEVER');
  await quickNote(page, 'Купить продукты');

  const firstCard = page.locator('#noteList .note-card').filter({ hasText: 'Идея для SEVER' });
  await firstCard.locator('.notes-org-action').click();
  await expect(page.locator('#notesActionDialog')).toBeVisible();
  await page.locator('[data-notes-action="pin"]').click();

  await expect(page.locator('#notesPinnedSection')).toBeVisible();
  await expect(page.locator('#notesPinnedList')).toContainText('Идея для SEVER');
  await expect(page.locator('#noteList .note-card').filter({ hasText: 'Идея для SEVER' })).toBeHidden();

  await page.locator('#notesPinnedList .notes-org-pinned-action').click();
  await page.locator('[data-notes-action="tags"]').click();
  await expect(page.locator('#notesTagDialog')).toBeVisible();
  await page.locator('#notesTagInput').fill('Проект, Идеи');
  await page.locator('#notesTagSave').click();

  await expect(page.locator('#notesPinnedList')).toContainText('#Проект');
  await expect(page.locator('#notesOrganizationTags')).toContainText('#Проект');
  await page.locator('#notesOrganizationTags button', { hasText: '#Проект' }).click();
  await expect(page.locator('#notesPinnedList')).toContainText('Идея для SEVER');
  await expect(page.locator('#noteList .note-card').filter({ hasText: 'Купить продукты' })).toBeHidden();

  const state = await page.evaluate(() => window.SeverApp.getState());
  const note = state.notes.find(item => item.title === 'Идея для SEVER');
  expect(state.profile.noteOrganization.v).toBe(1);
  expect(state.profile.noteOrganization.notes[note.id]).toEqual({ pinned: true, tags: ['Проект', 'Идеи'] });
});

test('protected notes remove organization tags before local persistence and cloud capture', async ({ page }) => {
  await page.evaluate(async () => {
    const state = window.SeverApp.getState();
    const now = Date.now();
    const locked = await window.SeverProtectedNotesCrypto.protect({
      title: 'Секрет', body: '', kind: 'text', items: [], done: false
    }, 'notes-organization-test-password', 100000);
    state.notes.push({
      id: 'protected-note', folderId: '', title: '', body: '', kind: 'protected', items: [], done: false,
      protected: true, secure: locked.secure, createdAt: now, updatedAt: now
    });
    state.profile.noteOrganization = { v: 1, notes: { 'protected-note': { pinned: true, tags: ['Секрет'] } } };
    await save();
    window.SeverNotes.render();
  });

  await expect(page.locator('#notesPinnedList')).toContainText('Защищённая заметка');
  await expect(page.locator('#notesOrganizationTags')).not.toContainText('Секрет');
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().profile.noteOrganization.notes['protected-note'].tags.length)).toBe(0);
  const persistedTags = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('sever-anonymous-state-v1'));
    return saved.profile.noteOrganization.notes['protected-note'].tags;
  });
  expect(persistedTags).toEqual([]);

  await page.locator('#notesPinnedList .notes-org-pinned-action').click();
  await expect(page.locator('[data-notes-action="tags"]')).toBeDisabled();
});

test('phone swipe left opens note actions without horizontal overflow', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Touch interaction check');
  await quickNote(page, 'Свайп заметка');
  const card = page.locator('#noteList .note-card').filter({ hasText: 'Свайп заметка' });
  await expect(card.locator('.notes-org-action')).toBeVisible();
  await card.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const start = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(start, 'touches', { value: [{ clientX: rect.right - 20, clientY: rect.top + 30 }] });
    element.dispatchEvent(start);
    const end = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(end, 'changedTouches', { value: [{ clientX: rect.left + 20, clientY: rect.top + 32 }] });
    element.dispatchEvent(end);
  });
  await expect(page.locator('#notesActionDialog')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
