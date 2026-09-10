const { test, expect } = require('@playwright/test');

async function seedPlanner(page) {
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true },
      onboarded: true
    }));
    localStorage.setItem('sever-theme', 'light');
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

test('mobile themes change the full Home composition, not only colors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPlanner(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.SeverApp))).toBe(true);

  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await page.locator('.theme-picker [data-sever-theme="light"]').click();
  await page.evaluate(() => { window.SeverApp.switchView('today'); scrollTo(0, 0); });
  await expect(page.locator('.today-motivation')).toBeVisible();
  await expect(page.locator('#todayDashboard')).toBeHidden();

  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await page.locator('.theme-picker [data-sever-theme="motion"]').click();
  await page.evaluate(() => { window.SeverApp.switchView('today'); scrollTo(0, 0); });
  await expect(page.locator('.today-motivation')).toBeHidden();
  await expect(page.locator('#todayDashboard')).toBeVisible();
  await expect(page.locator('#todayDashboard .dashboard-card:visible')).toHaveCount(3);

  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await page.locator('.theme-picker [data-sever-theme="black"]').click();
  await page.evaluate(() => { window.SeverApp.switchView('today'); scrollTo(0, 0); });
  await expect(page.locator('#todayDashboard')).toBeHidden();
  const focus = await page.locator('#todayFocusWidget').boundingBox();
  expect(focus.height).toBeGreaterThan(220);
  await expect(page.locator('.bottom-nav')).toBeVisible();
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
