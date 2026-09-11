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

test('Notes mobile filters stay reachable in one compact horizontal rail', async ({ page }, info) => {
  if (info.project.name === 'desktop') test.skip();
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  await expect(page.locator('#notesView .notes-core-filters')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const filters = document.querySelector('#notesView .notes-core-filters');
    const rect = filters.getBoundingClientRect();
    const buttons = [...filters.querySelectorAll('button')].map(button => {
      const box = button.getBoundingClientRect();
      return { left: box.left, right: box.right, height: box.height, text: button.textContent.trim() };
    });
    const sort = document.querySelector('#notesView .notes-core-sort')?.getBoundingClientRect();
    return {
      filters: { left: rect.left, right: rect.right, width: rect.width, clientWidth: filters.clientWidth, scrollWidth: filters.scrollWidth },
      overflowX: getComputedStyle(filters).overflowX,
      buttons,
      sortWidth: sort?.width || 0,
      pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
    };
  });

  expect(geometry.buttons.map(button => button.text)).toEqual(['Все', 'Заметки', 'Чек-листы', 'Защищённые']);
  expect(geometry.buttons[0].left).toBeGreaterThanOrEqual(geometry.filters.left - 1);
  expect(geometry.buttons[0].right).toBeLessThanOrEqual(geometry.filters.right + 1);
  for (const button of geometry.buttons) expect(button.height).toBeGreaterThanOrEqual(38);
  expect(['auto', 'scroll']).toContain(geometry.overflowX);
  expect(geometry.filters.scrollWidth).toBeGreaterThanOrEqual(geometry.filters.clientWidth);
  expect(geometry.sortWidth).toBeGreaterThan(0);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);

  await page.evaluate(() => {
    const filters = document.querySelector('#notesView .notes-core-filters');
    filters.scrollLeft = filters.scrollWidth;
  });
  await page.waitForTimeout(40);
  const last = await page.evaluate(() => {
    const filters = document.querySelector('#notesView .notes-core-filters').getBoundingClientRect();
    const button = document.querySelector('#notesView .notes-core-filters button:last-child').getBoundingClientRect();
    return { filtersLeft: filters.left, filtersRight: filters.right, left: button.left, right: button.right };
  });
  expect(last.left).toBeGreaterThanOrEqual(last.filtersLeft - 1);
  expect(last.right).toBeLessThanOrEqual(last.filtersRight + 1);
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
