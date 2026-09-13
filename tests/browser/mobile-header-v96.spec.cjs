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
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severSeasonSignature)).toBe('v101');
  await expect.poll(() => page.evaluate(() => document.querySelector('#severAiOpen')?.dataset.severHeaderDock)).toBe('true');
}

test('mobile header uses a stable sync dot and the current automatic SEVER season', async ({ page }, info) => {
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
  await expect(sync).toHaveAttribute('data-state', 'busy');
  await expect(sync).toHaveAttribute('aria-label', /синхронизирует/i);

  const result = await page.evaluate(() => {
    const syncEl = document.querySelector('#severMobileSyncIndicator');
    const aiEl = document.querySelector('#severAiOpen');
    const wordmark = document.querySelector('#mobileHeaderTitle');
    const syncBox = syncEl.getBoundingClientRect();
    const aiBox = aiEl.getBoundingClientRect();
    const wordmarkBox = wordmark.getBoundingClientRect();
    const mark = wordmark.querySelector('.sever-season-mark');
    const markBox = mark.getBoundingClientRect();
    const markStyle = getComputedStyle(mark);
    const copyStyle = getComputedStyle(syncEl.querySelector('.sever-sync-copy'));
    const icon = mark.querySelector('svg');
    const iconBox = icon.getBoundingClientRect();
    const iconStyle = getComputedStyle(icon);
    const aiStyle = getComputedStyle(aiEl);
    const month = new Date().getMonth();
    const expectedSeason = month === 11 || month <= 1 ? 'winter' : month <= 4 ? 'spring' : month <= 7 ? 'summer' : 'autumn';
    const overlaps = !(
      syncBox.right <= aiBox.left || aiBox.right <= syncBox.left ||
      syncBox.bottom <= aiBox.top || aiBox.bottom <= syncBox.top
    );
    const markCoversWordmark = markBox.left <= wordmarkBox.left + 1 && markBox.right >= wordmarkBox.right - 1;
    return {
      overlaps,
      gap: aiBox.left - syncBox.right,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      aiDocked: aiEl.parentElement?.classList.contains('top-actions') && aiEl.dataset.severHeaderDock === 'true',
      aiPosition: aiStyle.position,
      season: document.documentElement.dataset.severSeason,
      expectedSeason,
      markSeason: mark.dataset.season,
      markPosition: markStyle.position,
      markWidth: markBox.width,
      markHeight: markBox.height,
      markPointerEvents: markStyle.pointerEvents,
      markCoversWordmark,
      iconWidth: iconBox.width,
      iconHeight: iconBox.height,
      iconWillChange: iconStyle.willChange,
      iconAnimationName: iconStyle.animationName,
      syncWidth: syncBox.width,
      syncHeight: syncBox.height,
      copyWidth: Number.parseFloat(copyStyle.width)
    };
  });

  expect(result.aiDocked).toBe(true);
  expect(result.aiPosition).toBe('static');
  expect(result.overlaps).toBe(false);
  expect(result.gap).toBeGreaterThanOrEqual(4);
  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.syncWidth).toBeLessThanOrEqual(16);
  expect(result.syncHeight).toBeLessThanOrEqual(16);
  expect(result.copyWidth).toBeLessThanOrEqual(1.5);
  expect(result.season).toBe(result.expectedSeason);
  expect(result.markSeason).toBe(result.expectedSeason);
  expect(result.markPosition).toBe('absolute');
  expect(result.markPointerEvents).toBe('none');
  expect(result.iconWidth).toBeLessThanOrEqual(9);
  expect(result.iconHeight).toBeLessThanOrEqual(9);

  if (result.expectedSeason === 'autumn') {
    expect(result.markCoversWordmark).toBe(true);
    expect(result.markWidth).toBeGreaterThan(30);
    expect(result.markWidth).toBeLessThan(120);
    expect(result.iconWillChange).toContain('transform');
    expect(result.iconWillChange).toContain('opacity');
    expect(result.iconAnimationName).toBe('sever-autumn-flight-a');
  } else {
    expect(result.markWidth).toBeLessThanOrEqual(16);
    expect(result.markHeight).toBeLessThanOrEqual(16);
  }
});
