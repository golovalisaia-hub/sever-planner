const { test, expect } = require('@playwright/test');

test('auth succeeds quickly enough to recover even when initial sync stalls', async ({ page }) => {
  await page.route('**/supabase-config.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.SEVER_SUPABASE_CONFIG={};'
  }));
  await page.addInitScript(() => {
    window.__SEVER_CLOUD_RECOVERY_TIMEOUTS__ = { client: 20, auth: 20, session: 20, sync: 20, watchdog: 80 };
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }, onboarded: true
    }));
    localStorage.setItem('sever-theme', 'light');
  });

  await page.goto('/');
  await page.waitForFunction(() => window.SeverCloud && window.SeverCloudRecovery);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severCloudRecovery)).toBe('ready');

  const outcome = await page.evaluate(async () => {
    const cloud = window.SeverCloud;
    window.SeverSupabase.configured = () => true;
    window.SeverSupabase.health = () => ({ configured: true, sdkLoaded: true, clientReady: true, lastErrorCode: null });
    cloud.bindAuthListener = () => {};
    cloud.client = async () => ({
      auth: {
        signInWithPassword: async () => ({
          data: { session: { user: { id: 'recovery-user', email: 'recovery@example.test' } } },
          error: null
        })
      }
    });
    cloud.handleSession = function (user) {
      this.user = user;
      this.hydrated = false;
      this.setStatus('syncing');
      return new Promise(() => {});
    };

    const started = performance.now();
    const result = await cloud.signIn('recovery@example.test', 'not-a-real-password', false);
    return {
      elapsed: performance.now() - started,
      resultUser: result.session?.user?.id || '',
      cloudUser: cloud.user?.id || '',
      status: cloud.status,
      error: cloud.lastErrorCode
    };
  });

  expect(outcome.resultUser).toBe('recovery-user');
  expect(outcome.cloudUser).toBe('recovery-user');
  expect(outcome.elapsed).toBeLessThan(1000);
  expect(outcome.status).toBe('pending');
  expect(outcome.error).toBe('SYNC_TIMEOUT');

  await page.evaluate(() => window.SeverCloudUI.openAccount());
  await expect(page.locator('#accountDialog')).toBeVisible();
  await expect(page.locator('#accountHealth')).toBeVisible();
  await expect(page.locator('#accountHealth')).toContainText('Синхронизация зависла');
  await expect(page.locator('#accountRetry')).toBeVisible();
  await expect(page.locator('#accountRetry')).toHaveText('Восстановить связь');
});

test('recovery layer never deletes queued cloud edits while resetting a stuck client', async ({ page }) => {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    window.__SEVER_CLOUD_RECOVERY_TIMEOUTS__ = { client: 20, auth: 20, session: 20, sync: 20, watchdog: 80 };
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({ version: 11, tasks: [], notes: [], habits: [], onboarded: true }));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverCloudRecovery && window.SeverCloud);

  const kept = await page.evaluate(async () => {
    const cloud = window.SeverCloud;
    const user = { id: 'queue-user', email: 'queue@example.test' };
    cloud.user = user;
    const key = 'sever-cloud-queue-v2:queue-user';
    const payload = [{ collection: 'tasks', id: 't1', record: { id: 't1', title: 'Не потерять', syncVersions: { v: 1 } } }];
    localStorage.setItem(key, JSON.stringify(payload));

    window.SeverSupabase.configured = () => true;
    window.SeverSupabase.retry = async () => ({
      auth: { getSession: async () => { const error = new Error('network unavailable'); error.code = 'NETWORK_ERROR'; return { data: { session: null }, error }; } }
    });
    try { await cloud.recoverNow(); } catch {}
    return localStorage.getItem(key);
  });

  expect(JSON.parse(kept)).toHaveLength(1);
  expect(JSON.parse(kept)[0].record.title).toBe('Не потерять');
});
