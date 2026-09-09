const { test, expect } = require('@playwright/test');
test('installed release reloads offline with one complete asset set', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => { if (!localStorage.getItem('sever-anonymous-state-v1')) localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({ tasks: [], notes: [], habits: [], onboarded: true })); });
    await page.goto('http://127.0.0.1:41741/');
    await expect.poll(async () => { try { return await page.evaluate(() => Boolean(navigator.serviceWorker.controller && window.SeverApp)); } catch { return false; } }).toBe(true);
    const cached = await page.evaluate(async () => { const cache = await caches.open('sever-v54-release-validation'); return (await cache.keys()).map(request => new URL(request.url).pathname + new URL(request.url).search); });
    expect(cached).toContain('/mobile-home.css?v=52'); expect(cached).toContain('/app.js?v=54'); expect(cached).toContain('/notes-pro.js?v=52');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#todayView')).toBeVisible();
    await page.locator('.bottom-nav [data-view="calendar"]').click();
    await expect(page.locator('#calendarView')).toBeVisible();
    await expect(page.locator('#todayView')).toBeHidden();
    expect(await page.evaluate(() => window.SeverApp.getStorageScope())).toBe('sever-anonymous-state-v1');
  } finally { await context.close(); }
});
