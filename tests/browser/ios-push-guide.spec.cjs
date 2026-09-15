const { test, expect } = require('@playwright/test');

async function boot(page, theme) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(theme => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: true, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme, animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', theme);
  }, theme);
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severOnboarding === 'v110');
}

test('browser crypto accepts both shipped push keys', async ({ page }) => {
  await boot(page, 'light');
  const verified = await page.evaluate(async () => {
    for (const file of ['sever2-task-reminders.js', 'sever2-reminder-bridge-v95.js']) {
      const source = await (await fetch(file)).text();
      const key = source.match(/VAPID_PUBLIC_KEY = '([^']+)'/)[1];
      const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
      await crypto.subtle.importKey('raw', bytes, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    }
    return true;
  });
  expect(verified).toBe(true);
});

for (const theme of ['light', 'motion', 'black']) {
  test('guide reveals the page and follows its live target after Back: ' + theme, async ({ page }, info) => {
    await boot(page, theme);
    await page.evaluate(() => window.SeverApp.switchView('settings'));
    await page.locator('#settingsGuide').click();
    const dialog = page.locator('#tourDialog');
    await expect(dialog).toBeVisible();
    const surface = await dialog.evaluate(node => ({
      background: getComputedStyle(node).backgroundColor,
      backdrop: getComputedStyle(node, '::backdrop').backgroundColor,
      filter: getComputedStyle(node, '::backdrop').backdropFilter,
      duplicateShade: getComputedStyle(node, '::before').content
    }));
    expect(surface).toEqual({ background: 'rgba(0, 0, 0, 0)', backdrop: 'rgba(0, 0, 0, 0)', filter: 'none', duplicateShade: 'none' });
    await page.locator('#tourNext').click();
    await expect(dialog).toHaveAttribute('data-step', '2');
    await expect(page.locator('.guide-mask-ring')).toBeVisible();
    await page.screenshot({ path: info.outputPath('guide-' + theme + '-today.png') });
    for (let i = 0; i < 3; i++) await page.locator('#tourNext').click();
    await expect(dialog).toHaveAttribute('data-step', '5');
    await page.locator('#tourBack').click();
    await expect(dialog).toHaveAttribute('data-step', '4');
    await expect.poll(() => page.evaluate(() => {
      const target = document.querySelector('#timerView .timer-ring').getBoundingClientRect();
      const mask = document.querySelector('.guide-mask-ring').getBoundingClientRect();
      return target.width > 20 && Math.abs(mask.left - target.left) < 20 && Math.abs(mask.top - target.top) < 20 && mask.width >= target.width;
    })).toBe(true);
    await page.screenshot({ path: info.outputPath('guide-' + theme + '-back-to-focus.png') });
    await page.locator('#tourSkip').click();
    await expect(dialog).toBeHidden();
  });
}
