const { test, expect } = require('@playwright/test');
test('installed release reloads offline with one complete asset set', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => { if (!localStorage.getItem('sever-anonymous-state-v1')) localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({ tasks: [], notes: [], habits: [], onboarded: true })); });
    await page.goto('http://127.0.0.1:41741/');
    await expect.poll(async () => { try { return await page.evaluate(() => Boolean(navigator.serviceWorker.controller && window.SeverApp)); } catch { return false; } }).toBe(true);
    const cached = await page.evaluate(async () => { const cache = await caches.open('sever-v59-productivity-v2'); return (await cache.keys()).map(request => new URL(request.url).pathname + new URL(request.url).search); });
    expect(cached).toContain('/mobile-home.css?v=52');
    expect(cached).toContain('/desktop-system.css?v=60');
    expect(cached).not.toContain('/desktop-home.css?v=60');
    expect(cached).toContain('/themes.css?v=60');
    expect(cached).toContain('/sever2-ui.css?v=61');
    expect(cached).toContain('/sever2-qa.css?v=61');
    expect(cached).toContain('/sever2-productivity.css?v=62');
    expect(cached).toContain('/sever2-productivity.js?v=63');
    expect(cached).toContain('/js/theme-init.js?v=62');
    expect(cached).toContain('/app.js?v=51');
    expect(cached).toContain('/notes-pro.js?v=52');
    expect(cached).toContain('/js/sync-core.mjs?v=55');
    expect(cached).toContain('/js/cloud-runtime.js?v=55');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#todayView')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severProductivity)).toBe('ready');
    await page.locator('.bottom-nav [data-view="calendar"]').click();
    await expect(page.locator('#calendarView')).toBeVisible();
    await expect(page.locator('#todayView')).toBeHidden();
    await expect(page.locator('.sever2-calendar-modes')).toBeVisible();
    expect(await page.evaluate(() => window.SeverApp.getStorageScope())).toBe('sever-anonymous-state-v1');
  } finally { await context.close(); }
});
