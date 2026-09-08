const { test, expect } = require('@playwright/test');
test('legacy migration writes a one-time marker and retains the source backup', async ({ page }) => {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded','1'); localStorage.setItem('sever-data-v2',JSON.stringify({tasks:[{id:'legacy',title:'Legacy task'}],notes:[],habits:[],onboarded:true})); } });
  await page.goto('/'); await page.waitForFunction(() => window.SeverApp);
  expect(await page.evaluate(() => window.SeverApp.getState().tasks.map(t=>t.id))).toEqual(['legacy']);
  expect(await page.evaluate(() => localStorage.getItem('sever-legacy-migration-v1'))).toBeTruthy();
  await page.evaluate(async () => { window.SeverApp.getState().tasks=[]; await window.SeverApp.persist(); });
  await page.reload(); await page.waitForFunction(() => window.SeverApp);
  expect(await page.evaluate(() => window.SeverApp.getAnonymousImportCandidate().tasks)).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sever-data-v2')).tasks[0].id)).toBe('legacy');
});
