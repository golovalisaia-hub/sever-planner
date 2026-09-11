const { test, expect } = require('@playwright/test');

async function waitForThemeShell(page) {
  await page.waitForFunction(() => window.SeverApp && document.querySelector('.theme-picker')?.dataset.severThemePackReady === 'true');
}

async function bootFresh(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  /* Playwright gives each test an isolated browser context, so this is a true
     first visit without a reload-time init script that would erase persistence. */
  await page.goto('/');
  await waitForThemeShell(page);
}

test('a brand-new profile opens in Calm Balance and keeps it after reload', async ({ page }) => {
  await bootFresh(page);

  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().appearance?.theme)).toBe('light');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sever-theme'))).toBe('light');

  const themes = await page.locator('.theme-picker [data-sever-theme]').evaluateAll(buttons => buttons.map(button => ({
    id: button.dataset.severTheme,
    checked: button.getAttribute('aria-checked'),
    title: button.querySelector('b')?.textContent?.trim()
  })));

  expect(themes.map(theme => theme.id)).toEqual(['light', 'motion', 'black']);
  expect(themes.map(theme => theme.title)).toEqual(['Calm Balance', 'Cozy Mood', 'Focus Peak']);
  expect(themes[0].checked).toBe('true');
  expect(themes[1].checked).toBe('false');
  expect(themes[2].checked).toBe('false');

  await page.reload();
  await waitForThemeShell(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().appearance?.theme)).toBe('light');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sever-theme'))).toBe('light');
});

test('an existing user theme is preserved and is not reset by the first-run rule', async ({ page }) => {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-theme', 'motion');
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' },
      appearance: { theme: 'motion', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
  });
  await page.goto('/');
  await waitForThemeShell(page);

  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('motion');
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().appearance?.theme)).toBe('motion');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sever-theme'))).toBe('motion');
});
