import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwrightRoot = process.env.SEVER_PLAYWRIGHT_ROOT;
const { chromium } = playwrightRoot ? require(path.join(playwrightRoot, 'index.js')) : require('@playwright/test');
const baseURL = process.env.SEVER_E2E_URL || 'http://127.0.0.1:41740/';

const initialState = {
  version: 11,
  onboarded: true,
  challengeStart: '2026-09-06',
  challengeDays: 0,
  challengeName: '',
  tasks: [],
  notes: [],
  habits: [],
  checks: {},
  taskMemory: [],
  focusSessions: [],
  profile: { name: '' },
  appearance: { theme: 'black', animations: 'off', reduceEffects: true },
  stats: { focusMs: 0, sessions: 0 },
  reminders: { enabled: false, time: '19:00', lastDate: '' },
  security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }
};

async function openMoreView(page, view) {
  await page.locator('#mobileNavMore').click();
  await page.locator(`[data-menu-view="${view}"]`).click();
  await page.locator(`#${view}View`).waitFor({ state: 'visible' });
}

async function openSettings(page) {
  await page.locator('#mobileNavMore').click();
  await page.locator('#openSettingsMenu').click();
  await page.locator('#settingsView').waitFor({ state: 'visible' });
}

const browser = await chromium.launch({ headless: true, ...(process.env.SEVER_BROWSER_CHANNEL ? { channel: process.env.SEVER_BROWSER_CHANNEL } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.addInitScript(state => localStorage.setItem('sever-data-v2', JSON.stringify(state)), initialState);
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('#todayView').waitFor({ state: 'visible' });

  assert.equal((await page.locator('#mobileHeaderTitle').textContent())?.trim(), 'SEVER');
  await page.locator('.bottom-nav [data-view="calendar"]').click();
  await page.locator('#calendarView').waitFor({ state: 'visible' });
  assert.equal((await page.locator('#calendarPageTitle').textContent())?.trim(), 'Календарь');
  assert.equal((await page.locator('#mobileHeaderTitle').textContent())?.trim(), 'SEVER');

  await page.locator('.bottom-nav [data-view="notes"]').click();
  await page.locator('#notesView').waitFor({ state: 'visible' });
  await openMoreView(page, 'timer');
  await openMoreView(page, 'habits');
  await openMoreView(page, 'progress');
  await openSettings(page);

  for (const theme of ['calm', 'cozy', 'focus']) {
    await page.locator(`[data-sever-theme="${theme}"]`).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    assert.equal((await page.locator('#mobileHeaderTitle').textContent())?.trim(), 'SEVER');
    assert.equal(await page.locator('#settingsView').isVisible(), true);
  }

  await page.locator('#mobileCreateBtn').click();
  await page.locator('#quickAddHabit').click();
  await page.locator('#habitTitle').fill('Привычка E2E');
  await page.locator('#habitSubmit').click();
  await openMoreView(page, 'habits');

  let habit = page.locator('.habit').filter({ hasText: 'Привычка E2E' });
  await habit.waitFor({ state: 'visible' });
  let day = habit.locator('.habit-day:not(:disabled)').first();
  const date = await day.getAttribute('data-date');
  assert.ok(date, 'Habit date is missing');

  await day.click();
  assert.equal(await day.getAttribute('aria-pressed'), 'true');
  await page.locator('#toast.show button').click();
  assert.equal(await day.getAttribute('aria-pressed'), 'false');

  await day.click();
  assert.equal(await day.getAttribute('aria-pressed'), 'true');
  await habit.locator('.habit-edit').click();
  await page.locator('#deleteHabit').click();
  await page.locator('#confirmHabitDelete').click();
  assert.equal(await page.locator('.habit').count(), 0);
  await page.locator('#toast.show button').click();
  habit = page.locator('.habit').filter({ hasText: 'Привычка E2E' });
  await habit.waitFor({ state: 'visible' });
  day = habit.locator(`.habit-day[data-date="${date}"]`);
  assert.equal(await day.getAttribute('aria-pressed'), 'true');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#todayView').waitFor({ state: 'visible' });
  await openMoreView(page, 'habits');
  habit = page.locator('.habit').filter({ hasText: 'Привычка E2E' });
  await habit.waitFor({ state: 'visible' });
  assert.equal(await habit.locator(`.habit-day[data-date="${date}"]`).getAttribute('aria-pressed'), 'true');

  await page.locator('.bottom-nav [data-view="today"]').click();
  await page.locator('#mobileQuickNote').click();
  await page.locator('#quickNoteText').fill('Быстрая заметка E2E');
  await page.locator('#quickNoteForm .primary').click();
  await page.locator('#quickNoteDialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#todayView').isVisible(), true);
  await page.locator('.bottom-nav [data-view="notes"]').click();
  await page.locator('.note-card').filter({ hasText: 'Быстрая заметка E2E' }).waitFor({ state: 'visible' });

  await page.locator('#mobileCreateBtn').click();
  await page.locator('#quickCaptureInput').fill('Python E2E 1 минуту');
  await page.locator('#quickCaptureForm .primary').click();
  await page.locator('.bottom-nav [data-view="today"]').click();
  const task = page.locator('.task').filter({ hasText: 'Python E2E' });
  await task.locator('.task-open').click();
  assert.match((await page.locator('#taskActionStart').textContent()) || '', /Начать обучение/);
  await page.locator('#taskActionStart').click();
  await page.locator('#timerView').waitFor({ state: 'visible' });
  const before = (await page.locator('#timerDisplay').textContent())?.trim();
  await page.waitForTimeout(1200);
  const after = (await page.locator('#timerDisplay').textContent())?.trim();
  assert.equal(before, '01:00');
  assert.notEqual(after, before, 'Linked timer did not start counting down');
  await page.locator('#timerToggle').click();
  assert.equal((await page.locator('#timerToggle').textContent())?.trim(), 'Начать');

  console.log('PASS mobile navigation, three themes, habit date/Undo/reload, Quick Note and linked timer');
  await context.close();
} finally {
  await browser.close();
}
