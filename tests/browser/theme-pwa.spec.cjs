const { test, expect, chromium } = require('@playwright/test');
const { baseURL } = require('./test-server-config.cjs');
test('each theme survives offline reload and full persistent-browser/PWA restart without flash', async ({}, testInfo) => {
  test.setTimeout(90000);
  const userDataDir = testInfo.outputPath('theme-profile');
  const launch = () => chromium.launchPersistentContext(userDataDir, {
    headless: true, serviceWorkers: 'allow', viewport: testInfo.project.use.viewport,
    ...(process.env.SEVER_BROWSER_CHANNEL ? { channel: process.env.SEVER_BROWSER_CHANNEL } : {})
  });
  let context = await launch();
  try {
    let page = context.pages()[0];
    await page.addInitScript(() => {
      if (!localStorage.getItem('sever-anonymous-state-v1')) localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
        tasks: [], notes: [], habits: [], onboarded: true, appearance: { theme: 'calm', animations: 'off', reduceEffects: true }
      }));
    });
    await page.goto(baseURL + '/');
    await expect.poll(() => page.evaluate(() => Boolean(window.SeverApp && navigator.serviceWorker.controller)).catch(() => false)).toBe(true);
    await page.waitForTimeout(500);
    const cached = await page.evaluate(async () => {
      const cache = await caches.open('sever-v54-release-validation');
      return (await cache.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search);
    });
    expect(cached).toContain('/themes.css?v=53');
    expect(cached).toContain('/js/theme-init.js?v=53');
    for (const theme of ['calm', 'cozy', 'focus']) {
      await page.evaluate(() => SeverApp.switchView('settings'));
      await page.locator(`[data-sever-theme="${theme}"]`).click();
      await context.setOffline(true);
      await page.reload();
      await page.waitForFunction(() => window.SeverApp);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await context.close();
      context = await launch();
      await context.setOffline(true);
      page = context.pages()[0];
      await page.addInitScript(() => {
        window.__paintThemes = [];
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) window.__paintThemes.push(document.documentElement.dataset.theme);
        }).observe({ type: 'paint', buffered: true });
      });
      await page.goto(baseURL + '/');
      await page.waitForFunction(() => window.SeverApp);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect.poll(() => page.evaluate(() => window.__paintThemes.length)).toBeGreaterThan(0);
      expect(await page.evaluate(expected => window.__paintThemes.every(t => t === expected), theme)).toBe(true);
      expect(await page.evaluate(() => SeverApp.getState().appearance.theme)).toBe(theme);
      await context.setOffline(false);
    }
  } finally { await context.close(); }
});
