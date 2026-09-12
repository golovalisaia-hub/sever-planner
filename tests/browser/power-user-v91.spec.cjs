const { test, expect } = require('@playwright/test');

test.setTimeout(90000);

function seed() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = Date.now();
  return {
    version: 11,
    onboarded: true,
    tasks: [{ id: 'rapid-task', title: 'RAPID toggle', date: today, time: '', duration: 15, category: 'Личное', completed: false, createdAt: now, updatedAt: now }],
    notes: [], folders: [],
    habits: [{ id: 'rapid-habit', title: 'RAPID habit', createdAt: now, updatedAt: now }],
    checks: { 'rapid-habit': [] },
    taskMemory: [],
    profile: { name: 'POWER-QA' },
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
    sessionStorage.clear();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify(state));
    localStorage.setItem('sever-theme', 'light');
  }, seed());
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverCloudReady && document.documentElement.dataset.severPowerUser === 'v91');
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('identical rapid form actions dedupe but a changed value is accepted immediately', async ({ page }) => {
  const result = await page.evaluate(() => {
    const main = document.querySelector('main');
    const form = document.createElement('form');
    form.innerHTML = '<input id="rapidSynthetic" value="alpha">';
    main.appendChild(form);
    let accepted = 0;
    form.addEventListener('submit', event => { event.preventDefault(); accepted += 1; });
    const fire = () => form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    fire();
    fire();
    form.querySelector('input').value = 'beta';
    fire();
    const blocked = form.dataset.severRapidBlocked === 'true';
    form.remove();
    return { accepted, blocked };
  });
  expect(result).toEqual({ accepted: 2, blocked: true });
});

test('rapid double submit creates one task, not a duplicate', async ({ page }) => {
  await page.evaluate(() => {
    const input = document.querySelector('#quickInput');
    const form = document.querySelector('#quickForm');
    input.value = 'RAPID double submit';
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.filter(task => task.title === 'RAPID double submit').length)).toBe(1);
});

test('rapid task completion stays completed even when the first tap rerenders the button', async ({ page }) => {
  await page.evaluate(() => {
    const findCheck = () => [...document.querySelectorAll('#todayTasks .task')]
      .find(card => card.textContent.includes('RAPID toggle'))?.querySelector('.check');
    findCheck()?.click();
    findCheck()?.click();
  });
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 'rapid-task')?.completed)).toBe(true);
});

test('rapid habit tap stays checked even though the habit card rerenders after the first tap', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('habits'));
  await page.evaluate(() => {
    const findToday = () => [...document.querySelectorAll('#habitList .habit')]
      .find(card => card.textContent.includes('RAPID habit'))?.querySelector('.habit-day.today');
    findToday()?.click();
    findToday()?.click();
  });
  await expect.poll(() => page.evaluate(() => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return window.SeverApp.getState().checks['rapid-habit']?.includes(today) || false;
  })).toBe(true);
});

test('rapid double timer tap starts Focus instead of immediately pausing it', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('timer'));
  const toggle = page.locator('#timerToggle');
  await expect(toggle).toBeVisible();
  await toggle.evaluate(button => { button.click(); button.click(); });
  await expect(toggle).toHaveText('Пауза');
});

test('phone Settings keeps essentials visible and puts rare controls under one Advanced disclosure', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'mobile progressive disclosure only');
  await page.evaluate(() => window.SeverApp.switchView('settings'));
  const details = page.locator('#severSettingsAdvanced');
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute('open', '');
  await expect(page.locator('#settingsAccountButton')).toBeVisible();
  await expect(page.locator('#settingsGuide')).toBeVisible();
  await expect(details.locator('#protectedNotesAutoLock')).toBeHidden();
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('#protectedNotesAutoLock')).toBeVisible();
  await expect(details.locator('#settingsExport')).toBeVisible();
  await expect(details.locator('#severAiEnabled')).toBeVisible();
  await expect(details.locator('#settingsReset')).toBeVisible();
});

test('desktop Settings stays fully expanded and does not inherit the phone disclosure', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop-only contract');
  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await expect(page.locator('#severSettingsAdvanced')).toHaveCount(0);
  await expect(page.locator('#protectedNotesAutoLock')).toBeVisible();
  await expect(page.locator('#settingsExport')).toBeVisible();
  await expect(page.locator('#severAiEnabled')).toBeVisible();
});
