const { test, expect } = require('@playwright/test');

async function seedPlanner(page) {
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      tasks: [], notes: [], folders: [], habits: [], checks: [], taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true },
      onboarded: true
    }));
    localStorage.setItem('sever-theme', 'light');
  });
}

test('Settings exposes only Calm Balance, Cozy Mood and Focus Peak', async ({ page }) => {
  await seedPlanner(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.SeverApp))).toBe(true);
  await page.evaluate(() => window.SeverApp.switchView('settings'));

  const themes = page.locator('.theme-picker [data-sever-theme]');
  await expect(themes).toHaveCount(3);
  await expect(themes.nth(0).locator('b')).toHaveText('Calm Balance');
  await expect(themes.nth(1).locator('b')).toHaveText('Cozy Mood');
  await expect(themes.nth(2).locator('b')).toHaveText('Focus Peak');
  await expect(page.locator('.theme-picker [data-sever-theme="north"]')).toHaveCount(0);
  await expect(page.locator('.theme-picker [data-sever-theme="aurora"]')).toHaveCount(0);
});

test('all three themes switch immediately, keep geometry and persist', async ({ page }) => {
  await seedPlanner(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.SeverApp))).toBe(true);
  await page.evaluate(() => window.SeverApp.switchView('settings'));

  const baseline = await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav') || document.querySelector('.desktop-sidebar');
    const rect = nav.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });

  const expected = [
    ['light', 'Calm Balance'],
    ['motion', 'Cozy Mood'],
    ['black', 'Focus Peak']
  ];
  const backgrounds = [];

  for (const [id, label] of expected) {
    await page.locator(`.theme-picker [data-sever-theme="${id}"]`).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(id);
    await expect(page.locator(`.theme-picker [data-sever-theme="${id}"]`)).toHaveAttribute('aria-checked', 'true');
    const result = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const nav = document.querySelector('.bottom-nav') || document.querySelector('.desktop-sidebar');
      const rect = nav.getBoundingClientRect();
      return {
        bg: root.getPropertyValue('--app-bg').trim(),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        hero: getComputedStyle(document.querySelector('#todayView .today-hero')).backgroundImage,
        stored: localStorage.getItem('sever-theme')
      };
    });
    expect(result.stored).toBe(id);
    expect(result.width).toBe(baseline.width);
    expect(result.height).toBe(baseline.height);
    expect(result.hero).not.toMatch(/mountain|aurora\.webp/i);
    backgrounds.push(result.bg);
    const menuLabel = await page.locator('#menuTheme small').textContent().catch(() => '');
    if (menuLabel) expect(menuLabel).toBe(label);
  }

  expect(new Set(backgrounds).size).toBe(3);
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('black');
  expect(await page.evaluate(() => localStorage.getItem('sever-theme'))).toBe('black');
});
