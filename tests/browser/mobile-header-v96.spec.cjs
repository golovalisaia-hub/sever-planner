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
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severSeasonSignature)).toBe('v99');
  await expect.poll(() => page.evaluate(() => document.querySelector('#severAiOpen')?.dataset.severHeaderDock)).toBe('true');
}

test('mobile header keeps sync clear of AI and temporary summer SEVER signature restrained', async ({ page }, info) => {
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
    const syncEl = document.querySelector('#severMobileSyncIndicator');
    const aiEl = document.querySelector('#severAiOpen');
    const syncBox = syncEl.getBoundingClientRect();
    const aiBox = aiEl.getBoundingClientRect();
    const mark = document.querySelector('#mobileHeaderTitle .sever-season-mark');
    const markBox = mark.getBoundingClientRect();
    const markStyle = getComputedStyle(mark);
    const icon = mark.querySelector('svg');
    const iconBox = icon.getBoundingClientRect();
    const aiStyle = getComputedStyle(aiEl);
    const overlaps = !(
      syncBox.right <= aiBox.left || aiBox.right <= syncBox.left ||
      syncBox.bottom <= aiBox.top || aiBox.bottom <= syncBox.top
    );
    return {
      overlaps,
      gap: aiBox.left - syncBox.right,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      aiDocked: aiEl.parentElement?.classList.contains('top-actions') && aiEl.dataset.severHeaderDock === 'true',
      aiPosition: aiStyle.position,
      season: document.documentElement.dataset.severSeason,
      markSeason: mark.dataset.season,
      markPosition: markStyle.position,
      markWidth: markBox.width,
      markHeight: markBox.height,
      markPointerEvents: markStyle.pointerEvents,
      iconWidth: iconBox.width,
      iconHeight: iconBox.height
    };
  });

  expect(result.aiDocked).toBe(true);
  expect(result.aiPosition).toBe('static');
  expect(result.overlaps).toBe(false);
  expect(result.gap).toBeGreaterThanOrEqual(4);
  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.season).toBe('summer');
  expect(result.markSeason).toBe('summer');
  expect(result.markPosition).toBe('absolute');
  expect(result.markPointerEvents).toBe('none');
  expect(result.markWidth).toBeLessThanOrEqual(12);
  expect(result.markHeight).toBeLessThanOrEqual(12);
  expect(result.iconWidth).toBeLessThanOrEqual(12);
  expect(result.iconHeight).toBeLessThanOrEqual(12);
});
