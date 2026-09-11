const { test, expect } = require('@playwright/test');

async function seedPlanner(page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('sever-anonymous-state-v1')) {
      localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
        version: 11,
        tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
        profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
        focusSessions: [], stats: { focusMs: 0, sessions: 0 },
        reminders: { enabled: false, time: '19:00', lastDate: '' },
        security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true },
        onboarded: true
      }));
    }
    if (!localStorage.getItem('sever-theme')) localStorage.setItem('sever-theme', 'light');
  });
}

async function openSettings(page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.SeverApp))).toBe(true);
  await page.evaluate(() => window.SeverApp.switchView('settings'));
}

test('Settings exposes only Calm Balance, Cozy Mood and Focus Peak', async ({ page }) => {
  await seedPlanner(page);
  await page.goto('/');
  await openSettings(page);

  const themes = page.locator('.theme-picker [data-sever-theme]');
  await expect(themes).toHaveCount(3);
  await expect(themes.nth(0).locator('b')).toHaveText('Calm Balance');
  await expect(themes.nth(1).locator('b')).toHaveText('Cozy Mood');
  await expect(themes.nth(2).locator('b')).toHaveText('Focus Peak');
  await expect(page.locator('.theme-picker [data-sever-theme="north"]')).toHaveCount(0);
  await expect(page.locator('.theme-picker [data-sever-theme="aurora"]')).toHaveCount(0);
  await expect(page.locator('link[data-sever2-ui-pack]')).toHaveCount(1);
  await expect(page.locator('link[data-sever2-qa-pack]')).toHaveCount(1);
});

test('three references have distinct exact palette anchors and persist', async ({ page }) => {
  await seedPlanner(page);
  await page.goto('/');
  await openSettings(page);

  const expected = [
    ['light', 'Calm Balance', '#f1e9e3', '#8a735a'],
    ['motion', 'Cozy Mood', '#f3ece7', '#b66f5b'],
    ['black', 'Focus Peak', '#111618', '#8ad9c1']
  ];

  const navBaseline = await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav');
    const rect = nav.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });

  for (const [id, label, bg, accent] of expected) {
    await page.locator(`.theme-picker [data-sever-theme="${id}"]`).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(id);
    await expect(page.locator(`.theme-picker [data-sever-theme="${id}"]`)).toHaveAttribute('aria-checked', 'true');
    const result = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const nav = document.querySelector('.bottom-nav');
      const rect = nav.getBoundingClientRect();
      return {
        bg: root.getPropertyValue('--app-bg').trim().toLowerCase(),
        accent: root.getPropertyValue('--accent').trim().toLowerCase(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        hero: getComputedStyle(document.querySelector('#todayView .today-hero')).backgroundImage,
        stored: localStorage.getItem('sever-theme'),
        mood: document.documentElement.dataset.severMood,
        menu: document.querySelector('#menuTheme small')?.textContent || ''
      };
    });
    expect(result.stored).toBe(id);
    expect(result.bg).toBe(bg);
    expect(result.accent).toBe(accent);
    expect(result.width).toBe(navBaseline.width);
    expect(result.height).toBe(navBaseline.height);
    expect(result.hero).not.toMatch(/mountain|aurora\.webp/i);
    expect(result.menu).toBe(label);
    expect(['calm', 'cozy', 'focus']).toContain(result.mood);
  }

  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('black');
  expect(await page.evaluate(() => localStorage.getItem('sever-theme'))).toBe('black');
});

test('legacy Aurora planner data is not rewritten just by opening SEVER 2', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'aurora', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }, onboarded: true
    }));
    localStorage.setItem('sever-theme', 'aurora');
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.SeverApp))).toBe(true);
  const result = await page.evaluate(() => ({
    storedDataTheme: window.SeverApp.getState().appearance.theme,
    visibleTheme: document.documentElement.dataset.theme
  }));
  expect(result.storedDataTheme).toBe('aurora');
  expect(result.visibleTheme).toBe('light');
});

test('all mobile themes keep one Home hierarchy while preserving their visual mood', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPlanner(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severHomeCore)).toBe('ready');

  const heights = {};
  for (const id of ['light', 'motion', 'black']) {
    await page.evaluate(() => window.SeverApp.switchView('settings'));
    await page.locator(`.theme-picker [data-sever-theme="${id}"]`).click();
    await page.evaluate(() => { window.SeverApp.switchView('today'); scrollTo(0, 0); });
    await expect(page.locator('#sever2HomeCore')).toBeVisible();
    await expect(page.locator('.today-motivation')).toBeHidden();
    await expect(page.locator('#todayDashboard')).toBeHidden();
    await expect(page.locator('#todayFocusWidget')).toBeHidden();
    await expect(page.locator('#todayView .today-utilities')).toBeHidden();
    await expect(page.locator('#sever2HomeCore [data-home-action="create"]')).toBeVisible();
    heights[id] = await page.locator('#sever2HomeCore').evaluate(el => el.getBoundingClientRect().height);
  }
  expect(Math.max(...Object.values(heights)) - Math.min(...Object.values(heights))).toBeLessThanOrEqual(3);
  await expect(page.locator('.bottom-nav')).toBeVisible();
});

test('mobile Notes empty state is compact and the new Home focus action stays inside its card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPlanner(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.SeverApp))).toBe(true);

  await page.evaluate(() => window.SeverApp.switchView('notes'));
  const empty = page.locator('#notesView .empty');
  await expect(empty).toBeVisible();
  await expect(empty.locator('.today-add-task')).toBeHidden();
  const emptyBox = await empty.boundingBox();
  expect(emptyBox.height).toBeLessThanOrEqual(260);

  await page.evaluate(() => {
    const app = window.SeverApp;
    const state = app.getState();
    const date = new Date().toLocaleDateString('sv-SE');
    state.tasks.push({ id: 'theme-home-focus', title: 'Фокус', date, duration: 25, completed: false, category: 'Личное', createdAt: Date.now(), updatedAt: Date.now() });
    app.render();
    app.switchView('settings');
  });
  await page.locator('.theme-picker [data-sever-theme="black"]').click();
  await page.evaluate(() => { window.SeverApp.switchView('today'); scrollTo(0, 0); });
  await expect(page.locator('#todayFocusWidget')).toBeHidden();
  const geometry = await page.evaluate(() => {
    const card = document.querySelector('#sever2HomeCore .sever2-home-now').getBoundingClientRect();
    const button = document.querySelector('#sever2HomeCore [data-home-action="focus"]').getBoundingClientRect();
    return { card: card.toJSON(), button: button.toJSON() };
  });
  expect(geometry.button.left).toBeGreaterThanOrEqual(geometry.card.left);
  expect(geometry.button.right).toBeLessThanOrEqual(geometry.card.right);
  expect(geometry.button.top).toBeGreaterThanOrEqual(geometry.card.top);
  expect(geometry.button.bottom).toBeLessThanOrEqual(geometry.card.bottom);
  expect(geometry.button.height).toBeGreaterThanOrEqual(44);
});

test('desktop Focus Peak becomes focus-first while Calm remains task-first', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedPlanner(page);
  await page.goto('/');
  await openSettings(page);

  await page.locator('.theme-picker [data-sever-theme="light"]').click();
  await page.evaluate(() => { window.SeverApp.switchView('today'); scrollTo(0, 0); });
  const calm = await page.evaluate(() => getComputedStyle(document.querySelector('#todayView')).display);
  expect(calm).toBe('flex');

  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await page.locator('.theme-picker [data-sever-theme="black"]').click();
  await page.evaluate(() => { window.SeverApp.switchView('today'); scrollTo(0, 0); });
  const focusLayout = await page.evaluate(() => ({
    display: getComputedStyle(document.querySelector('#todayView')).display,
    columns: getComputedStyle(document.querySelector('#todayView')).gridTemplateColumns,
    height: document.querySelector('#todayFocusWidget').getBoundingClientRect().height,
    sidebar: document.querySelector('.desktop-sidebar').getBoundingClientRect().width,
    filters: getComputedStyle(document.querySelector('#todayFilters')).display
  }));
  expect(focusLayout.display).toBe('grid');
  expect(focusLayout.columns.split(' ').length).toBeGreaterThanOrEqual(2);
  expect(focusLayout.height).toBeGreaterThan(280);
  expect(focusLayout.sidebar).toBeGreaterThan(180);
  expect(focusLayout.filters).toBe('none');
});

test('desktop AI is a header action and does not overlap Create', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedPlanner(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.SeverApp))).toBe(true);
  const geometry = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return { ai: box('#severAiOpen'), topbar: box('.topbar'), create: box('#globalAddBtn') };
  });
  expect(geometry.ai.width).toBeGreaterThanOrEqual(44);
  expect(geometry.ai.top).toBeGreaterThanOrEqual(geometry.topbar.top);
  expect(geometry.ai.bottom).toBeLessThanOrEqual(geometry.topbar.bottom);
  expect(geometry.ai.right).toBeLessThanOrEqual(geometry.create.left - 6);
});
