const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: 'ADMIN' },
      appearance: { theme: 'light', animations: 'auto', reduceEffects: false },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.querySelector('#severAiOpen'));
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severExperience)).toBe('v94');
}

test('mobile header keeps sync status clear of the AI launcher and preserves the minimal snow accent', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop');
  await boot(page);

  await page.evaluate(() => {
    const cloud = window.SeverCloud;
    if (cloud) {
      try { Object.defineProperty(cloud, 'configured', { configurable: true, value: true }); } catch {}
      cloud.status = 'syncing';
      cloud.health = () => ({ configured: true, session: 'signed-in', status: 'syncing', lastErrorCode: null });
      window.dispatchEvent(new CustomEvent('sever:cloud-status', { detail: cloud.health() }));
    }
  });

  const sync = page.locator('#severMobileSyncIndicator');
  const ai = page.locator('#severAiOpen');
  await expect(sync).toBeVisible();
  await expect(ai).toBeVisible();
  await expect(sync.locator('.sever-sync-copy')).toHaveText('Синхронизация…');

  const result = await page.evaluate(() => {
    const syncBox = document.querySelector('#severMobileSyncIndicator').getBoundingClientRect();
    const aiBox = document.querySelector('#severAiOpen').getBoundingClientRect();
    const snow = getComputedStyle(document.querySelector('#mobileHeaderTitle'), '::after');
    const overlaps = !(
      syncBox.right <= aiBox.left || aiBox.right <= syncBox.left ||
      syncBox.bottom <= aiBox.top || aiBox.bottom <= syncBox.top
    );
    return {
      overlaps,
      gap: aiBox.left - syncBox.right,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      snowContent: snow.content,
      snowPosition: snow.position
    };
  });

  expect(result.overlaps).toBe(false);
  expect(result.gap).toBeGreaterThanOrEqual(4);
  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.snowContent).toContain('❄');
  expect(result.snowPosition).toBe('absolute');
});
