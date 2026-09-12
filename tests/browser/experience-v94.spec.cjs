const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severExperience)).toBe('v94');
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('fresh phone Notes shows capture first and reveals organization after the first note', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop');
  await page.evaluate(() => window.SeverApp.switchView('notes'));
  const view = page.locator('#notesView');
  await expect(view).toHaveAttribute('data-notes-library-state', 'empty');
  await expect(view).toHaveClass(/notes-v94-empty-library/);
  await expect(page.locator('#notesQuickCaptureInput')).toBeVisible();
  await expect(page.locator('#notesView .notes-navigation-sticky')).toBeHidden();
  await expect(page.locator('#notesView .notes-core-controls')).toBeHidden();

  const input = page.locator('#notesQuickCaptureInput');
  await input.fill('Первая заметка');
  await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().notes.length)).toBe(1);
  await expect(view).toHaveAttribute('data-notes-library-state', 'ready');
  await expect(view).not.toHaveClass(/notes-v94-empty-library/);
  await expect(page.locator('#notesCompactType')).toBeVisible();
  await expect(page.locator('#notesView .notes-core-controls')).toBeVisible();
});

test('phone Progress starts with a compact two-column dashboard without horizontal overflow', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop');
  await page.evaluate(() => window.SeverApp.switchView('progress'));
  await expect(page.locator('#progressView')).toBeVisible();
  const metrics = await page.evaluate(() => {
    const stats = document.querySelector('#progressView .stats');
    const style = getComputedStyle(stats);
    const first = stats?.querySelector('article')?.getBoundingClientRect();
    return {
      columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
      firstHeight: first?.height || 0,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
    };
  });
  expect(metrics.columns).toBe(2);
  expect(metrics.firstHeight).toBeGreaterThanOrEqual(92);
  expect(metrics.overflow).toBeLessThanOrEqual(1);
});

test('phone Settings section index keeps 44px touch targets', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop');
  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await expect(page.locator('#settingsMobileIndex')).toBeVisible();
  const heights = await page.locator('#settingsMobileIndex button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThanOrEqual(5);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
});

test('phone cloud warning exposes a working recovery action without opening a modal', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop');
  await page.evaluate(() => {
    const cloud = window.SeverCloud;
    Object.defineProperty(cloud, 'configured', { configurable: true, value: true });
    cloud.lastErrorCode = 'SYNC_TIMEOUT';
    cloud.status = 'pending';
    cloud.health = () => ({
      configured: true,
      session: 'signed-in',
      status: 'pending',
      lastErrorCode: cloud.lastErrorCode
    });
    window.__severV94RecoverCount = 0;
    cloud.recoverNow = async () => {
      window.__severV94RecoverCount += 1;
      cloud.lastErrorCode = null;
      cloud.status = 'synced';
      cloud.health = () => ({ configured: true, session: 'signed-in', status: 'synced', lastErrorCode: null });
      window.dispatchEvent(new CustomEvent('sever:cloud-status', { detail: cloud.health() }));
      return { signedIn: true, syncPending: false };
    };
    window.dispatchEvent(new CustomEvent('sever:cloud-status', { detail: cloud.health() }));
  });

  const indicator = page.locator('#severMobileSyncIndicator');
  await expect(indicator).toBeVisible();
  await expect(indicator.locator('.sever-sync-copy')).toHaveText('Связь с облаком');
  await expect(indicator.locator('.sever-sync-retry')).toBeVisible();
  await indicator.locator('.sever-sync-retry').click();
  await expect.poll(() => page.evaluate(() => window.__severV94RecoverCount)).toBe(1);
  await expect(indicator).toBeHidden();
  await expect(page.locator('#accountDialog')).not.toHaveAttribute('open', '');
});
