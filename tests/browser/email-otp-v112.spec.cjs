const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const safeName = value => String(value || 'project').replace(/[^a-z0-9_-]+/gi, '-');
async function shot(page, project, label) {
  const out = path.resolve('visual-review/sever2-v109');
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, `${safeName(project)}-v112-email-otp-${label}.png`), fullPage: true });
}

test('account login uses email then a six-digit OTP with no password field', async ({ page }, testInfo) => {
  test.skip(!['phone-390', 'desktop'].includes(testInfo.project.name), 'Phone 390 and desktop cover the OTP flow and release visuals.');

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
      pushReminders: { enabled: false, dayBefore: true, fifteenMinutes: true, legacyRetired: true },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
  });

  await page.goto('/');
  await page.waitForFunction(() => window.SeverCloudUI && document.documentElement.dataset.severEmailOtp === 'v112');

  await page.evaluate(() => {
    window.__otpCalls = [];
    const user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.com' };
    window.SeverSupabase.configured = () => true;
    window.SeverSupabase.getClient = async () => ({
      auth: {
        signInWithOtp: async payload => {
          window.__otpCalls.push({ kind: 'send', payload });
          return { data: {}, error: null };
        },
        verifyOtp: async payload => {
          window.__otpCalls.push({ kind: 'verify', payload });
          return { data: { session: { user } }, error: null };
        }
      }
    });
    window.SeverCloud.restoreSession = async () => true;
    window.SeverCloudUI.openAccount();
  });

  await expect(page.locator('#accountDialog')).toBeVisible();
  await expect(page.locator('#accountPassword')).toBeHidden();
  await expect(page.locator('#accountMode')).toBeHidden();
  await expect(page.locator('#accountRetry')).toBeHidden();
  await expect(page.locator('#accountTitle')).toHaveText('Войти в SEVER');
  await expect(page.locator('#accountCopy')).toContainText('Пароль не нужен');
  await shot(page, testInfo.project.name, 'email');

  await page.locator('#accountEmailInput').fill('TEST@EXAMPLE.COM');
  await page.locator('#accountSubmit').click();

  await expect(page.locator('#accountTitle')).toHaveText('Введите код');
  await expect(page.locator('#severOtpCode')).toBeVisible();
  await expect(page.locator('#severOtpCode')).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(page.locator('#accountRetry')).toBeHidden();
  await expect(page.locator('#accountSubmit')).toHaveText('Подтвердить код');
  await expect(page.locator('#severOtpResend')).toBeDisabled();
  await shot(page, testInfo.project.name, 'code');

  const send = await page.evaluate(() => window.__otpCalls.find(call => call.kind === 'send'));
  expect(send.payload.email).toBe('test@example.com');
  expect(send.payload.options.shouldCreateUser).toBe(true);

  await page.locator('#severOtpCode').fill('12a34 56');
  await expect(page.locator('#severOtpCode')).toHaveValue('123456');
  await page.locator('#accountSubmit').click();
  await expect(page.locator('#accountDialog')).toBeHidden();

  const verify = await page.evaluate(() => window.__otpCalls.find(call => call.kind === 'verify'));
  expect(verify.payload).toEqual({ email: 'test@example.com', token: '123456', type: 'email' });
});
