const { test, expect } = require('@playwright/test');
test('installed release reloads offline with one complete asset set', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => { if (!localStorage.getItem('sever-anonymous-state-v1')) localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({ tasks: [], notes: [], habits: [], onboarded: true })); });
    await page.goto('http://127.0.0.1:41741/');
    await expect.poll(async () => { try { return await page.evaluate(() => Boolean(navigator.serviceWorker.controller && window.SeverApp)); } catch { return false; } }).toBe(true);
    let cached = [];
    await expect.poll(async () => {
      try {
        cached = await page.evaluate(async () => {
          const cache = await caches.open('sever-v77-pwa-startup-guard-v1');
          return (await cache.keys()).map(request => new URL(request.url).pathname + new URL(request.url).search);
        });
        return cached.includes('/sever2-notes-core.js?v=71') && cached.includes('/sever2-notes-organization.js?v=72') && cached.includes('/sever2-notes-editor-flow.js?v=73') && cached.includes('/sever2-notes-navigation.js?v=74') && cached.includes('/sever2-notes-polish.js?v=79') && cached.includes('/sever2-mobile-consistency.css?v=76') && cached.includes('/sever2-money.js?v=77') && cached.includes('/sever2-interaction-polish.js?v=78') && cached.includes('/sever2-cloud-recovery.js?v=80') && cached.includes('/js/theme-init.js?v=81');
      } catch { return false; }
    }).toBe(true);
    for (const asset of [
      '/mobile-home.css?v=52','/desktop-system.css?v=60','/themes.css?v=60','/sever2-ui.css?v=61','/sever2-qa.css?v=61',
      '/sever2-productivity.css?v=64','/sever2-productivity.js?v=64','/sever2-focus-flow.css?v=66','/sever2-focus-flow.js?v=66',
      '/sever2-efficiency.css?v=67','/sever2-efficiency.js?v=67','/sever2-calendar-clarity.css?v=68','/sever2-calendar-clarity.js?v=68',
      '/sever2-create-flow.js?v=69','/sever2-home-core.css?v=70','/sever2-home-core.js?v=70','/sever2-notes-core.css?v=71','/sever2-notes-core.js?v=71',
      '/sever2-notes-organization.css?v=72','/sever2-notes-organization.js?v=72','/sever2-notes-editor-flow.css?v=73','/sever2-notes-editor-flow.js?v=73',
      '/sever2-notes-navigation.css?v=74','/sever2-notes-navigation.js?v=74','/sever2-notes-polish.css?v=79','/sever2-notes-polish.js?v=79',
      '/sever2-mobile-consistency.css?v=76','/sever2-money.css?v=77','/sever2-money.js?v=77',
      '/sever2-interaction-polish.css?v=78','/sever2-interaction-polish.js?v=78','/sever2-cloud-recovery.css?v=80','/sever2-cloud-recovery.js?v=80','/js/theme-init.js?v=81','/app.js?v=51','/notes-pro.js?v=52','/js/sync-core.mjs?v=55','/js/cloud-runtime.js?v=55'
    ]) expect(cached).toContain(asset);
    expect(cached).not.toContain('/desktop-home.css?v=60');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#todayView')).toBeVisible();
    for (const key of ['severProductivity','severFocusFlow','severEfficiency','severCalendarClarity','severCreateFlow','severHomeCore','severNotesCore','severNotesOrganization','severNotesEditorFlow','severNotesNavigation','severNotesPolish','severMoney','severInteractionPolish','severCloudRecovery']) {
      await expect.poll(() => page.evaluate(name => document.documentElement.dataset[name], key)).toBe('ready');
    }
    await expect(page.locator('link[data-sever2-notes-polish-pack]')).toHaveAttribute('href', /sever2-notes-polish\.css\?v=79$/);
    await expect(page.locator('link[data-sever2-mobile-consistency-pack]')).toHaveAttribute('href', /sever2-mobile-consistency\.css\?v=76$/);
    await expect(page.locator('link[data-sever2-money-pack]')).toHaveAttribute('href', /sever2-money\.css\?v=77$/);
    await expect(page.locator('link[data-sever2-interaction-polish-pack]')).toHaveAttribute('href', /sever2-interaction-polish\.css\?v=78$/);
    await expect(page.locator('link[data-sever2-cloud-recovery-pack]')).toHaveAttribute('href', /sever2-cloud-recovery\.css\?v=80$/);
    await expect(page.locator('#sever2HomeCore')).toBeVisible();
    await page.locator('.bottom-nav [data-view="calendar"]').click();
    await expect(page.locator('#calendarView')).toBeVisible();
    await expect(page.locator('#todayView')).toBeHidden();
    await expect(page.locator('.sever2-calendar-modes')).toBeVisible();
    await expect(page.locator('#sever2MonthHistory')).toBeVisible();
    await page.evaluate(() => window.SeverApp.switchView('money'));
    await expect(page.locator('#moneyView')).toBeVisible();
    expect(await page.evaluate(() => window.SeverApp.getStorageScope())).toBe('sever-anonymous-state-v1');
  } finally { await context.close(); }
});
