const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const safeName = value => String(value || 'project').replace(/[^a-z0-9_-]+/gi, '-');

async function shot(page, projectName, label) {
  const out = path.resolve('visual-review/sever2-v109');
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, `${safeName(projectName)}-${label}.png`), fullPage: true });
}

async function boot(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.SEVER_SUPABASE_CONFIG={};'
  }));
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: true, tasks: [], notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: 'SEVER' }, appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 }, reminders: { enabled: false, time: '19:00', lastDate: '' },
      pushReminders: { enabled: false, dayBefore: true, fifteenMinutes: true, legacyRetired: true },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
    }));
    localStorage.setItem('sever-theme', 'light');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverCloud && window.SeverCloudUI && document.documentElement.dataset.severEmailOtpAuth === 'v1111');
  await page.evaluate(() => {
    const cloud = window.SeverCloud;
    window.SeverSupabase.configured = () => true;
    window.SeverSupabase.health = () => ({ configured: true, sdkLoaded: true, clientReady: true, lastErrorCode: null });
    cloud.bindAuthListener = () => {};
    cloud.client = async () => ({
      auth: {
        signInWithOtp: async payload => {
          window.__otpSend = payload;
          return { data: { user: null, session: null }, error: null };
        },
        verifyOtp: async payload => {
          window.__otpVerify = payload;
          return { data: { session: { user: { id: 'otp-user-1', email: payload.email } }, user: { id: 'otp-user-1', email: payload.email } }, error: null };
        }
      }
    });
    cloud.applySession = async user => { cloud.user = user; };
    window.SeverCloudUI.openAccount();
  });
  await expect(page.locator('#accountDialog')).toBeVisible();
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('account login is email then six-digit OTP with no visible password or registration mode', async ({ page }, testInfo) => {
  const email = page.locator('#accountEmailInput');
  const passwordLabel = page.locator('#accountPassword').locator('xpath=ancestor::label[1]');
  const mode = page.locator('#accountMode');
  const submit = page.locator('#accountSubmit');

  await expect(passwordLabel).toBeHidden();
  await expect(mode).toBeHidden();
  await expect(submit).toHaveText('Получить код');
  await expect(page.locator('#accountCopy')).toContainText('одноразовый код');
  expect(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth))).toBeLessThanOrEqual(1);
  await shot(page, testInfo.project.name, 'otp-email');

  await email.fill('otp@example.test');
  await submit.click();

  await expect(page.locator('#accountOtpStep')).toBeVisible();
  await expect(page.locator('#accountOtpCode')).toBeFocused();
  await expect(page.locator('#accountOtpCode')).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(submit).toHaveText('Войти');
  await expect(page.locator('#accountOtpResend')).toBeDisabled();
  await expect(page.locator('#accountOtpResend')).toContainText('через 60 сек');
  expect(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth))).toBeLessThanOrEqual(1);
  await shot(page, testInfo.project.name, 'otp-code');

  const sent = await page.evaluate(() => window.__otpSend);
  expect(sent.email).toBe('otp@example.test');
  expect(sent.options.shouldCreateUser).toBe(true);

  await page.locator('#accountOtpCode').fill('12a34 56');
  await expect(page.locator('#accountOtpCode')).toHaveValue('123456');
  await submit.click();
  await expect(page.locator('#accountDialog')).toBeHidden();

  const verified = await page.evaluate(() => ({ payload: window.__otpVerify, user: window.SeverCloud.user }));
  expect(verified.payload).toEqual({ email: 'otp@example.test', token: '123456', type: 'email' });
  expect(verified.user.id).toBe('otp-user-1');
  expect(verified.user.email).toBe('otp@example.test');
});

test('user can return from code step and change email without exposing password login', async ({ page }) => {
  await page.locator('#accountEmailInput').fill('first@example.test');
  await page.locator('#accountSubmit').click();
  await expect(page.locator('#accountOtpStep')).toBeVisible();

  await page.locator('#accountOtpChangeEmail').click();
  await expect(page.locator('#accountOtpStep')).toBeHidden();
  await expect(page.locator('#accountEmailInput')).toBeVisible();
  await expect(page.locator('#accountSubmit')).toHaveText('Получить код');
  await expect(page.locator('#accountPassword').locator('xpath=ancestor::label[1]')).toBeHidden();
  await expect(page.locator('#accountMode')).toBeHidden();
});
