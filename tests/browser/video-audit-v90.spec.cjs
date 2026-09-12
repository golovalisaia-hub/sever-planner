const { test, expect } = require('@playwright/test');

async function seedEmptyPlanner(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      challengeStart: new Date().toISOString().slice(0, 10),
      challengeDays: 0,
      challengeName: '',
      tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: 'QA' },
      appearance: { theme: 'aurora', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
  });
}

async function waitReady(page) {
  await page.waitForFunction(() => window.SeverApp && document.querySelector('#settingsMobileIndex'));
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedEmptyPlanner(page);
  await page.goto('/');
  await waitReady(page);
});

test('video audit: empty day plan exposes exactly one add-task action', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('calendar'));
  await page.locator('#calendar .day.today').click();
  await expect(page.locator('#dayDialog')).toBeVisible();
  await expect(page.locator('#dayTaskList .empty')).toBeVisible();
  await expect(page.locator('#dayTaskList .empty .today-add-task')).toHaveCount(0);
  await expect(page.locator('#dayDialog > .day-add-task')).toHaveCount(1);
  await expect(page.locator('#dayDialog > .day-add-task')).toBeVisible();
});

test('video audit: mobile Settings has fast section navigation and manual Guide still opens', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await expect(page.locator('#settingsMobileIndex')).toBeVisible();
  expect(await page.locator('#settingsMobileIndex button').count()).toBeGreaterThanOrEqual(6);

  await page.locator('#settingsGuide').scrollIntoViewIfNeeded();
  await page.locator('#settingsGuide').click();
  await expect(page.locator('#tourDialog')).toBeVisible();
  await expect(page.locator('#tourTitle')).toHaveText('Добро пожаловать в SEVER');
});

test('video audit: guide reveals the actual target instead of a solid grey screen', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await page.locator('#settingsGuide').scrollIntoViewIfNeeded();
  await page.locator('#settingsGuide').click();
  await page.locator('#tourNext').click();

  await expect(page.locator('#tourDialog')).toHaveAttribute('data-guide-mask-target', 'true');
  await expect(page.locator('#tourDialog .guide-mask-ring')).toBeVisible();

  const target = page.locator('#todayGreeting');
  await expect(target).toBeVisible();
  const overlap = await page.evaluate(() => {
    const ring = document.querySelector('#tourDialog .guide-mask-ring').getBoundingClientRect();
    const target = document.querySelector('#todayGreeting').getBoundingClientRect();
    return Math.abs(ring.left - target.left) < 20
      && Math.abs(ring.top - target.top) < 20
      && ring.width >= target.width
      && ring.height >= target.height;
  });
  expect(overlap).toBe(true);

  await page.locator('#tourNext').click();
  await page.locator('#tourNext').click();
  await page.locator('#tourNext').click();
  await expect(page.locator('#tourDialog')).toHaveAttribute('data-step', '5');
  await expect(page.locator('#tourDialog')).toHaveAttribute('data-guide-mask-target', 'true');
  const finalOverlap = await page.evaluate(() => {
    const ring = document.querySelector('#tourDialog .guide-mask-ring').getBoundingClientRect();
    const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
    return ring.left <= nav.left + 8 && ring.right >= nav.right - 8 && ring.top <= nav.top + 8;
  });
  expect(finalOverlap).toBe(true);
});

test('video audit: rapid mobile sheet switches leave one modal sheet open and no page error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.evaluate(() => {
    document.querySelector('#openNote')?.click();
    document.querySelector('.bottom-nav button[data-mobile-more="true"]')?.click();
    document.querySelector('.bottom-nav button[data-mobile-more="true"]')?.click();
  });

  await expect(page.locator('#mobileMenuSheet')).toBeVisible();
  await expect(page.locator('dialog.mobile-sheet[open]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('video audit: checklist More expands inline and never opens the editor', async ({ page }) => {
  await page.evaluate(() => {
    const state = window.SeverApp.getState();
    const now = Date.now();
    state.notes.push({
      id: 'qa-long-checklist',
      folderId: '',
      title: 'Машина',
      body: 'Проверить перед поездкой',
      kind: 'checklist',
      protected: false,
      done: false,
      createdAt: now,
      updatedAt: now,
      items: ['Фара', 'Ручник', 'Подушка', 'Ручки дверей', 'Прошивка', 'Колёса'].map((text, index) => ({ id: `row-${index}`, text, done: false }))
    });
    window.SeverNotes.render();
    window.SeverApp.switchView('notes');
  });

  const card = page.locator('.note-card[data-note-id="qa-long-checklist"]');
  await expect(card).toBeVisible();
  const more = card.locator('.notes-core-more-items');
  await expect(more).toContainText('Ещё 3');
  await expect(card.locator('.note-check').nth(3)).toBeHidden();

  await more.click();
  await expect(page.locator('#noteDialog')).toBeHidden();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(more).toContainText('Свернуть');
  await expect(card).toHaveClass(/notes-polish-checklist-expanded/);
  await expect(card.locator('.note-check').nth(3)).toBeVisible();

  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('.note-check').nth(3)).toBeHidden();
});

test('video audit: checklist editor is compact and its action bar does not cover checklist rows', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await page.locator('#openNote').click();
  await expect(page.locator('#noteCreateSheet')).toBeVisible();
  await page.locator('#noteCreateNote').click();
  await expect(page.locator('#noteDialog')).toBeVisible();

  await page.locator('#noteDialog [data-note-type="checklist"]').click();
  await expect(page.locator('#checklistEditor')).toBeVisible();
  for (let i = 0; i < 7; i++) await page.locator('#addNoteItem').click();

  const metrics = await page.locator('#noteBody').evaluate(element => {
    const style = getComputedStyle(element);
    return { minHeight: parseFloat(style.minHeight), maxHeight: parseFloat(style.maxHeight) };
  });
  expect(metrics.minHeight).toBeLessThanOrEqual(90);
  expect(metrics.maxHeight).toBeLessThanOrEqual(120);

  const last = page.locator('#noteItemsEditor .note-item-editor').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();
  const overlap = await page.evaluate(() => {
    const row = document.querySelector('#noteItemsEditor .note-item-editor:last-child').getBoundingClientRect();
    const actions = document.querySelector('#noteDialog .dialog-actions').getBoundingClientRect();
    const intersects = Math.max(0, Math.min(row.bottom, actions.bottom) - Math.max(row.top, actions.top));
    return intersects;
  });
  expect(overlap).toBeLessThanOrEqual(1);
});
