const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

function seedState() {
  return {
    version: 11,
    onboarded: true,
    tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
    profile: { name: 'STARTUP-QA' },
    appearance: { theme: 'light', animations: 'off', reduceEffects: true },
    focusSessions: [], stats: { focusMs: 0, sessions: 0 },
    reminders: { enabled: false, time: '19:00', lastDate: '' },
    security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
  };
}

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.SEVER_SUPABASE_CONFIG={};window.SEVER_CLOUD_ENABLED=false;'
  }));
  await page.addInitScript(state => {
    localStorage.clear();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify(state));
    localStorage.setItem('sever-theme', 'light');
    window.__severStartupTimeline = { initScript: performance.now(), ready: null, cloudReady: null };
    window.addEventListener('sever:ready', () => {
      let savedAt = 0;
      try { savedAt = Number(JSON.parse(localStorage.getItem('sever-anonymous-state-v1') || '{}')._savedAt) || 0; } catch {}
      window.__severStartupTimeline.ready = {
        at: performance.now(),
        savedAt,
        storageText: document.querySelector('#storageStatus')?.textContent || ''
      };
    }, { once: true });
    window.addEventListener('sever:cloud-ready', () => {
      let savedAt = 0;
      try { savedAt = Number(JSON.parse(localStorage.getItem('sever-anonymous-state-v1') || '{}')._savedAt) || 0; } catch {}
      window.__severStartupTimeline.cloudReady = {
        at: performance.now(),
        savedAt,
        storageText: document.querySelector('#storageStatus')?.textContent || ''
      };
    }, { once: true });
  }, seedState());
  await page.goto('/');
}

test('sever:ready is emitted only after the initial local state is durably initialized', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-320', 'startup ordering only needs one deterministic viewport');
  await boot(page);
  await page.waitForFunction(() => window.__severStartupTimeline?.ready);
  const snapshot = await page.evaluate(() => window.__severStartupTimeline.ready);

  // `sever:ready` is the contract used by presentation modules. At that point
  // the initial planner state must already have completed its first persistence
  // pass; otherwise a fast user action can race IndexedDB recovery/save.
  expect(snapshot.savedAt, JSON.stringify(snapshot)).toBeGreaterThan(0);
  expect(snapshot.storageText, JSON.stringify(snapshot)).not.toContain('Проверяем');
});

test('an immediate Money plan survives the whole startup handoff and a reload', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-320', 'race stress runs on the narrow/slow phone profile');
  await boot(page);
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severMoney === 'ready');

  await page.evaluate(() => window.SeverApp.switchView('money'));
  await page.locator('[data-money-create="goal"]').click();
  await page.locator('#moneyItemName').fill('STARTUP Money');
  await page.locator('#moneyItemTarget').fill('30000');
  await page.locator('#moneyItemBudget').fill('10000');
  await page.locator('#moneyItemForm button.primary').click();
  await expect(page.locator('.money-card').filter({ hasText: 'STARTUP Money' })).toBeVisible();

  await page.waitForFunction(() => window.SeverCloudReady === true);
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().profile?.money?.items?.some(item => item.title === 'STARTUP Money') || false), {
    timeout: 10000,
    message: 'Money item disappeared while startup finished'
  }).toBe(true);

  await page.reload();
  await page.waitForFunction(() => window.SeverApp && window.SeverCloudReady && document.documentElement.dataset.severMoney === 'ready');
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().profile?.money?.items?.some(item => item.title === 'STARTUP Money') || false), {
    timeout: 10000,
    message: 'Money item did not survive reload'
  }).toBe(true);
});
