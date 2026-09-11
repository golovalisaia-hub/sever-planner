const { test, expect } = require('@playwright/test');

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function boot(page) {
  const today = isoToday();
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(seed => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      tasks: [
        { id: 'focus-a', title: 'Главное дело', date: seed, time: '10:00', duration: 45, completed: false, category: 'Личное', priority: true, createdAt: 1 },
        { id: 'focus-b', title: 'Небольшая задача', date: seed, time: '15:30', duration: 20, completed: false, category: 'Другое', priority: false, createdAt: 2 }
      ],
      notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }, onboarded: true
    }));
    localStorage.setItem('sever-theme', 'light');
  }, today);
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.querySelector('link[data-sever2-mobile-consistency-pack]') && document.documentElement.dataset.severMoney === 'ready');
}

async function setTheme(page, theme) {
  await page.evaluate(value => {
    localStorage.setItem('sever-theme', value);
    document.documentElement.dataset.theme = value;
  }, theme);
  await page.waitForTimeout(40);
}

async function bottomClearance(page, viewSelector) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(40);
  return page.evaluate(selector => {
    const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
    const view = document.querySelector(selector)?.getBoundingClientRect();
    return {
      navTop: nav?.top ?? 0,
      navHeight: nav?.height ?? 0,
      viewBottom: view?.bottom ?? 0,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      innerHeight
    };
  }, viewSelector);
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('all three themes keep Timer controls reachable above fixed bottom navigation', async ({ page }, info) => {
  if (info.project.name === 'desktop') test.skip();
  await page.evaluate(() => window.SeverApp.switchView('timer'));
  await expect(page.locator('#timerView')).toBeVisible();

  for (const theme of ['light', 'motion', 'black']) {
    await setTheme(page, theme);
    await page.locator('#timerView .timer-reset').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(40);

    const geometry = await page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
      const reset = document.querySelector('#timerView .timer-reset').getBoundingClientRect();
      const presets = [...document.querySelectorAll('#timerView .timer-presets button')].map(el => el.getBoundingClientRect());
      const ring = document.querySelector('#timerView .timer-ring').getBoundingClientRect();
      return {
        navTop: nav.top,
        resetBottom: reset.bottom,
        resetHeight: reset.height,
        presetHeights: presets.map(rect => rect.height),
        ringRight: ring.right,
        ringLeft: ring.left,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        width: innerWidth
      };
    });

    expect(geometry.resetBottom).toBeLessThanOrEqual(geometry.navTop - 8);
    expect(geometry.resetHeight).toBeGreaterThanOrEqual(44);
    expect(Math.min(...geometry.presetHeights)).toBeGreaterThanOrEqual(44);
    expect(geometry.ringLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.ringRight).toBeLessThanOrEqual(geometry.width);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
  }
});

test('every primary mobile view can scroll fully above the navigation in every theme', async ({ page }, info) => {
  if (info.project.name === 'desktop') test.skip();
  for (const theme of ['light', 'motion', 'black']) {
    await setTheme(page, theme);
    for (const view of ['today', 'calendar', 'timer', 'notes', 'habits', 'progress', 'money', 'settings']) {
      await page.evaluate(name => window.SeverApp.switchView(name), view);
      await expect(page.locator(`#${view}View`)).toBeVisible();
      const geometry = await bottomClearance(page, `#${view}View`);
      expect(geometry.viewBottom, `${theme}/${view} content is hidden under nav`).toBeLessThanOrEqual(geometry.navTop - 8);
      expect(geometry.navHeight).toBeGreaterThanOrEqual(54);
      expect(geometry.overflow, `${theme}/${view} overflows horizontally`).toBeLessThanOrEqual(1);
    }
  }
});

test('Notes mobile uses one compact type selector without losing the existing filter behavior', async ({ page }, info) => {
  if (info.project.name === 'desktop') test.skip();
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await page.waitForFunction(() => document.documentElement.dataset.severNotesCompact === 'v87');

  const compact = page.locator('#notesCompactType');
  await expect(compact).toBeVisible();
  await expect(page.locator('#notesView .notes-core-filters')).toBeHidden();
  await expect(page.locator('#notesView > .view-intro')).toBeHidden();
  await expect(compact.locator('option')).toHaveText(['Все типы', 'Заметки', 'Чек-листы', 'Защищённые']);

  const geometry = await page.evaluate(() => {
    const type = document.querySelector('#notesCompactType').getBoundingClientRect();
    const sort = document.querySelector('#notesCoreSort').getBoundingClientRect();
    const controls = document.querySelector('#notesView .notes-core-controls').getBoundingClientRect();
    return {
      typeHeight: type.height,
      sortHeight: sort.height,
      typeTop: type.top,
      sortTop: sort.top,
      controlsWidth: controls.width,
      right: Math.max(type.right, sort.right),
      left: Math.min(type.left, sort.left),
      pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
    };
  });
  expect(geometry.typeHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.sortHeight).toBeGreaterThanOrEqual(44);
  expect(Math.abs(geometry.typeTop - geometry.sortTop)).toBeLessThanOrEqual(2);
  expect(geometry.right - geometry.left).toBeLessThanOrEqual(geometry.controlsWidth + 1);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);

  await compact.selectOption('checklist');
  await expect(compact).toHaveValue('checklist');
  await expect(page.locator('[data-notes-core-filter="checklist"]')).toHaveClass(/active/);
});

test('Notes desktop keeps the expanded type controls', async ({ page }, info) => {
  if (info.project.name !== 'desktop') test.skip();
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await page.waitForFunction(() => document.documentElement.dataset.severNotesCompact === 'v87');
  await expect(page.locator('#notesView .notes-core-filters')).toBeVisible();
  await expect(page.locator('#notesCompactType')).toBeHidden();
  await expect(page.locator('#notesView > .view-intro')).toBeVisible();
});

test('mobile navigation keeps comfortable hit areas without visually oversized controls', async ({ page }, info) => {
  if (info.project.name === 'desktop') test.skip();
  const boxes = await page.locator('.bottom-nav button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(boxes.length).toBeGreaterThanOrEqual(5);
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeLessThanOrEqual(72);
  }
});
