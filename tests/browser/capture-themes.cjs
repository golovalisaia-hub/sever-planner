// Run the local browser server first. --baseline records the pre-stage geometry.
const { chromium } = require('@playwright/test');
const fs = require('node:fs'), path = require('node:path');
const { views, sizes, boot, show, geometry } = require('./theme-helpers.cjs');
(async () => {
  const baseline = process.argv.includes('--baseline');
  const out = path.resolve('.artifacts/themes');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(process.env.SEVER_BROWSER_CHANNEL ? { channel: process.env.SEVER_BROWSER_CHANNEL } : {});
  const rows = [];
  try {
    for (const [width, height] of sizes) {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
      const page = await context.newPage();
      if (baseline) {
        const { execFileSync } = require('node:child_process');
        // Read-only baseline from the pre-stage commit, without switching branches.
        await page.route('**/*', async route => {
          const url = new URL(route.request().url());
          const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          if (!/\.(html|css|js|mjs)$/.test(file) || file === 'supabase-config.js') return route.fallback();
          try {
            const body = execFileSync('git', ['show', `b5ade7b3325be577ed84e9cfd11a32bb39d38875:${file}`], { maxBuffer: 8 * 1024 * 1024 });
            await route.fulfill({ body, contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'text/javascript' });
          } catch { await route.fallback(); }
        });
      }
      await boot(page, baseline ? 'aurora' : 'calm');
      for (const theme of baseline ? ['aurora'] : ['calm', 'cozy', 'focus']) {
        if (!baseline) {
          await page.evaluate(() => window.SeverApp.switchView('settings'));
          await page.locator(`[data-sever-theme="${theme}"]`).click();
          await page.waitForTimeout(2600);
        }
        for (const view of views) {
          await show(page, view);
          rows.push({ width, height, theme, view, geometry: await geometry(page) });
          if (!baseline) await page.screenshot({ path: path.join(out, `${theme}-${width}x${height}-${view}.png`), fullPage: true });
          if (view === 'ai') await page.locator('#severAiClose').click();
        }
      }
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, baseline ? 'baseline.json' : 'geometry.json'), JSON.stringify(rows, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
