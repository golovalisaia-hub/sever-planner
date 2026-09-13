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
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severSeasonSignature)).toBe('v96');
}

test('mobile header keeps sync clear of AI and seasonal SEVER signature tiny', async ({ page }, info) => {
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
  const mark = page.locator('#mobileHeaderTitle .sever-season-mark');
  await expect(sync).toBeVisible();
  await expect(ai).toBeVisible();
  await expect(mark).toHaveCount(1);
  await expect(mark.locator('svg')).toHaveCount(1);
  await expect(sync.locator('.sever-sync-copy')).toHaveText('Синхронизация…');

  const result = await page.evaluate(() => {
    const syncBox = document.querySelector('#severMobileSyncIndicator').getBoundingClientRect();
    const aiBox = document.querySelector('#severAiOpen').getBoundingClientRect();
    const mark = document.querySelector('#mobileHeaderTitle .sever-season-mark');
    const markBox = mark.getBoundingClientRect();
    const markStyle = getComputedStyle(mark);
    const month = new Date().getMonth();
    const expectedSeason = month === 11 || month <= 1 ? 'winter' : month <= 4 ? 'spring' : month <= 7 ? 'summer' : 'autumn';
    const overlaps = !(
      syncBox.right <= aiBox.left || aiBox.right <= syncBox.left ||
      syncBox.bottom <= aiBox.top || aiBox.bottom <= syncBox.top
    );
    return {
      overlaps,
      gap: aiBox.left - syncBox.right,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      season: document.documentElement.dataset.severSeason,
      expectedSeason,
      markSeason: mark.dataset.season,
      markPosition: markStyle.position,
      markWidth: markBox.width,
      markHeight: markBox.height
    };
  });

  expect(result.overlaps).toBe(false);
  expect(result.gap).toBeGreaterThanOrEqual(4);
  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.season).toBe(result.expectedSeason);
  expect(result.markSeason).toBe(result.expectedSeason);
  expect(result.markPosition).toBe('absolute');
  expect(result.markWidth).toBeLessThanOrEqual(12);
  expect(result.markHeight).toBeLessThanOrEqual(12);
});
