const { test, expect } = require('@playwright/test');

test('leaving the targeted timer step physically detaches its spotlight layer', async ({ page }) => {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: false, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severOnboarding === 'v110');
  await expect(page.locator('#tourDialog')).toBeVisible();

  for (let step = 1; step < 4; step += 1) await page.locator('#tourNext').click();
  await expect(page.locator('#sever110GuideStep')).toHaveText('4 / 5');
  await expect(page.locator('#tourDialog')).toHaveAttribute('data-has-target', 'true');
  await page.evaluate(() => { window.__severOldSpotlight = document.querySelector('#guideSpotlight'); });
  await expect(page.locator('#guideSpotlight')).toBeVisible();

  await page.locator('#tourNext').click();
  await expect(page.locator('#sever110GuideStep')).toHaveText('5 / 5');
  await expect(page.locator('#tourDialog')).toHaveAttribute('data-has-target', 'false');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80)))));

  const state = await page.evaluate(() => ({
    oldConnected: Boolean(window.__severOldSpotlight?.isConnected),
    replaced: window.__severOldSpotlight !== document.querySelector('#guideSpotlight'),
    display: getComputedStyle(document.querySelector('#guideSpotlight')).display,
    resetStep: document.querySelector('#guideSpotlight')?.dataset?.severResetStep || ''
  }));
  expect(state.oldConnected).toBe(false);
  expect(state.replaced).toBe(true);
  expect(state.display).toBe('none');
  expect(state.resetStep).toBe('5');
});
