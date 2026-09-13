const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks: [],
      notes: [{
        id: 'note-v104',
        title: 'Проверка скорости',
        body: '',
        kind: 'checklist',
        items: [
          { id: 'a', text: 'Первый', done: false },
          { id: 'b', text: 'Второй', done: false },
          { id: 'c', text: 'Третий', done: false },
          { id: 'd', text: 'Четвёртый', done: false }
        ],
        done: false,
        protected: false,
        folderId: '',
        createdAt: now,
        updatedAt: now
      }],
      folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes);
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await expect(page.locator('#notesView')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severNotesResponsiveness)).toBe('v104');
  await expect(page.locator('.note-card[data-note-id="note-v104"]')).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test('checklist taps update the existing card immediately and persist without a full Notes rebuild', async ({ page }) => {
  const card = page.locator('.note-card[data-note-id="note-v104"]');
  const checks = card.locator('.note-checklist input[type="checkbox"]');
  await expect(checks).toHaveCount(4);
  await expect(card.locator('.note-ring b')).toHaveText('0%');

  await page.evaluate(() => {
    window.__severV104Card = document.querySelector('.note-card[data-note-id="note-v104"]');
  });

  await checks.nth(0).click();
  await expect(checks.nth(0)).toBeChecked();
  await expect(card.locator('.note-check').nth(0)).toHaveClass(/done/);
  await expect(card.locator('.note-ring b')).toHaveText('25%');
  expect(await page.evaluate(() => window.SeverApp.getState().notes[0].items[0].done)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('.note-card[data-note-id="note-v104"]') === window.__severV104Card)).toBe(true);

  await page.waitForTimeout(250);
  expect(await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('sever-anonymous-state-v1'));
    return stored.notes.find(note => note.id === 'note-v104')?.items?.[0]?.done;
  })).toBe(true);
  expect(await page.evaluate(() => document.querySelector('.note-card[data-note-id="note-v104"]') === window.__severV104Card)).toBe(true);

  await checks.nth(1).click();
  await checks.nth(2).click();
  await expect(card.locator('.note-ring b')).toHaveText('75%');
  expect(await page.evaluate(() => document.querySelector('.note-card[data-note-id="note-v104"]') === window.__severV104Card)).toBe(true);

  const bulk = card.locator('.note-toggle-all');
  await bulk.click();
  await expect(card.locator('.note-ring b')).toHaveText('100%');
  await expect(card).toHaveClass(/complete/);
  expect(await page.evaluate(() => window.SeverApp.getState().notes[0].items.every(item => item.done))).toBe(true);
  expect(await page.evaluate(() => document.querySelector('.note-card[data-note-id="note-v104"]') === window.__severV104Card)).toBe(true);
});
