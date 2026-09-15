const { test, expect } = require('@playwright/test');

async function bootOtp(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.SEVER_SUPABASE_CONFIG={};'
  }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: 'SEVER' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      pushReminders: { enabled: false, dayBefore: true, fifteenMinutes: true, legacyRetired: true },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });

  await page.goto('/');
  await page.waitForFunction(() => window.SeverCloud && document.documentElement.dataset.severEmailOtp === 'v112');
  await page.evaluate(() => {
    const calls = [];
    const fakeClient = {
      auth: {
        signInWithOtp: async options => {
          calls.push({ kind: 'send', options: structuredClone(options) });
          return { data: {}, error: null };
        },
        verifyOtp: async options => {
          calls.push({ kind: 'verify', options: structuredClone(options) });
          return {
            data: {
              user: { id: 'otp-user-1', email: options.email },
              session: { user: { id: 'otp-user-1', email: options.email } }
            },
            error: null
          };
        }
      }
    };
    window.__otpCalls = calls;
    window.__legacyPasswordCalls = 0;
    window.SeverSupabase.configured = () => true;
    window.SeverSupabase.health = () => ({ configured: true, sdkLoaded: true, clientReady: true, lastErrorCode: null });
    window.SeverSupabase.getClient = async () => fakeClient;
    window.SeverCloud.signIn = async () => {
      window.__legacyPasswordCalls += 1;
      throw new Error('legacy password path must not run');
    };
    window.SeverCloud.applySession = async function(user) {
      this.user = user;
      this.hydrated = true;
      this.setStatus('synced');
    };
  });
}

test('v112 signs in with email then one-time code without exposing the password flow', async ({ page }) => {
  await bootOtp(page);
  await page.evaluate(() => window.SeverCloudUI.openAccount());

  const dialog = page.locator('#accountDialog');
  const email = page.locator('#accountEmailInput');
  const password = page.locator('#accountPassword');
  const submit = page.locator('#accountSubmit');
  const code = page.locator('#accountCode');
  const resend = page.locator('#accountResend');

  await expect(dialog).toBeVisible();
  await expect(page.locator('#accountTitle')).toHaveText('Войти в SEVER');
  await expect(email).toBeVisible();
  await expect(password.locator('xpath=ancestor::label[1]')).toBeHidden();
  await expect(password).not.toHaveAttribute('required', '');
  await expect(submit).toHaveText('Получить код');
  await expect(page.locator('#accountMode')).toBeHidden();

  await email.fill('person@example.test');
  await submit.click();

  await expect(page.locator('#accountTitle')).toHaveText('Введите код');
  await expect(email.locator('xpath=ancestor::label[1]')).toBeHidden();
  await expect(code).toBeVisible();
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(page.locator('#accountCopy')).toContainText('person@example.test');
  await expect(submit).toHaveText('Войти');
  await expect(resend).toBeVisible();
  await expect(resend).toBeDisabled();
  await expect(resend).toContainText('Отправить снова через');

  const sendCall = await page.evaluate(() => window.__otpCalls[0]);
  expect(sendCall).toEqual({
    kind: 'send',
    options: { email: 'person@example.test', options: { shouldCreateUser: true } }
  });

  await code.fill('123456');
  await submit.click();
  await expect(dialog).toBeHidden();

  const result = await page.evaluate(() => ({
    calls: window.__otpCalls,
    legacyPasswordCalls: window.__legacyPasswordCalls,
    userId: window.SeverCloud.user?.id || '',
    userEmail: window.SeverCloud.user?.email || ''
  }));
  expect(result.legacyPasswordCalls).toBe(0);
  expect(result.userId).toBe('otp-user-1');
  expect(result.userEmail).toBe('person@example.test');
  expect(result.calls[1]).toEqual({
    kind: 'verify',
    options: { email: 'person@example.test', token: '123456', type: 'email' }
  });
});

test('v112 keeps the code screen open and explains an invalid OTP', async ({ page }) => {
  await bootOtp(page);
  await page.evaluate(() => {
    const calls = window.__otpCalls;
    window.SeverSupabase.getClient = async () => ({
      auth: {
        signInWithOtp: async options => {
          calls.push({ kind: 'send', options: structuredClone(options) });
          return { data: {}, error: null };
        },
        verifyOtp: async options => {
          calls.push({ kind: 'verify', options: structuredClone(options) });
          return { data: null, error: { code: 'otp_expired', message: 'Token has expired or is invalid' } };
        }
      }
    });
    window.SeverCloudUI.openAccount();
  });

  await page.locator('#accountEmailInput').fill('person@example.test');
  await page.locator('#accountSubmit').click();
  await page.locator('#accountCode').fill('654321');
  await page.locator('#accountSubmit').click();

  await expect(page.locator('#accountDialog')).toBeVisible();
  await expect(page.locator('#accountCode')).toBeVisible();
  await expect(page.locator('#accountError')).toBeVisible();
  await expect(page.locator('#accountError')).toContainText('Код истёк');
  await expect(page.locator('#accountCode')).toHaveValue('');
});
