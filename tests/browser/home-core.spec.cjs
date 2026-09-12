const { test, expect } = require('@playwright/test');

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function boot(page, tasks = []) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(seed => {
    if (localStorage.getItem('sever-e2e-home-core-seeded-v1') === '1') return;
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      tasks: seed,
      notes: [], folders: [], habits: [], checks: {}, taskMemory: [],
      profile: { name: '' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true },
      onboarded: true
    }));
    localStorage.setItem('sever-theme', 'light');
    localStorage.setItem('sever-e2e-home-core-seeded-v1', '1');
  }, tasks);
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severHomeCore === 'ready');
}

function createButton(page, projectName) {
  return page.locator(projectName === 'desktop' ? '#globalAddBtn' : '#mobileCreateBtn');
}

test('Home keeps one primary task without mutating planner data', async ({ page }, info) => {
  const today = isoToday();
  const phone = info.project.name !== 'desktop';
  const tasks = [
    { id: 'later', title: 'Позднее дело', date: today, time: '18:00', duration: 20, completed: false, category: 'Личное', priority: false, createdAt: 3 },
    { id: 'priority', title: 'Важное дело', date: today, time: '', duration: 30, completed: false, category: 'Личное', priority: true, createdAt: 2 },
    { id: 'goal', title: 'Шаг по цели', date: today, time: '', duration: 15, completed: false, category: 'Цель', challenge: true, createdAt: 1 },
    { id: 'done', title: 'Уже готово', date: today, time: '09:00', duration: 10, completed: true, completedAt: Date.now(), category: 'Личное', createdAt: 0 },
    { id: 'inbox', title: 'Без даты', date: '9999-12-31', time: '', duration: null, completed: false, category: 'Личное', createdAt: 4 }
  ];
  await boot(page, tasks);

  const before = await page.evaluate(() => JSON.stringify(window.SeverApp.getState()));
  await expect(page.locator('#sever2HomeCore')).toBeVisible();
  await expect(page.locator('[data-home-now-title]')).toHaveText('Шаг по цели');
  await expect(page.locator('[data-home-stat="remaining"]')).toHaveText('3');
  await expect(page.locator('[data-home-stat="minutes"]')).toHaveText('65 мин');
  await expect(page.locator('[data-home-stat="progress"]')).toHaveText('25%');
  await expect(page.locator('[data-home-inbox-count]')).toHaveText('1');

  const followUp = page.locator('.sever2-home-priority');
  if (phone) {
    await expect(followUp).toBeHidden();
    await expect(page.locator('#todayTasks')).toContainText('Шаг по цели');
    await expect(page.locator('#todayTasks')).toContainText('Важное дело');
    await expect(page.locator('#todayTasks')).toContainText('Позднее дело');
  } else {
    await expect(followUp).toBeVisible();
    await expect(followUp.locator('header')).toContainText('ДАЛЬШЕ');
    await expect(page.locator('.sever2-home-priority-copy b')).toHaveText(['Важное дело', 'Позднее дело']);
    await expect(page.locator('.sever2-home-priority-number')).toHaveText(['2', '3']);
    await expect(followUp).not.toContainText('Шаг по цели');
  }

  const hierarchy = await page.evaluate(() => {
    const hero = document.querySelector('#todayView .today-hero').getBoundingClientRect();
    const home = document.querySelector('#sever2HomeCore').getBoundingClientRect();
    return { heroTop: hero.top, heroBottom: hero.bottom, homeTop: home.top, order: getComputedStyle(document.querySelector('#sever2HomeCore')).order };
  });
  expect(hierarchy.heroTop).toBeLessThan(hierarchy.homeTop);
  expect(hierarchy.heroBottom).toBeLessThanOrEqual(hierarchy.homeTop + 2);
  expect(hierarchy.order).toBe('2');
  await expect(page.locator('#todayDashboard')).toBeHidden();
  await expect(page.locator('.course-card')).toBeHidden();
  expect(await page.evaluate(() => JSON.stringify(window.SeverApp.getState()))).toBe(before);
});

test('Home Create and Inbox actions keep the existing product flows', async ({ page }, info) => {
  await boot(page, [
    { id: 'inbox', title: 'Разобрать позже', date: '9999-12-31', time: '', duration: null, completed: false, category: 'Личное', createdAt: 1 }
  ]);

  await expect(page.locator('[data-home-action="create"]')).toBeVisible();
  await expect(page.locator('.sever2-home-priority')).toBeHidden();
  await page.locator('[data-home-action="create"]').click();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await page.locator('[data-close="quickAddDialog"]').click();

  await page.locator('[data-home-inbox]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await expect(page.locator('#sever2InboxPanel')).toBeVisible();
  await expect(page.locator('#sever2InboxPanel')).toContainText('Разобрать позже');

  await page.evaluate(() => window.SeverApp.switchView('today'));
  await createButton(page, info.project.name).click();
  await page.locator('#quickCaptureInput').fill('Новое дело');
  await page.locator('#quickCaptureForm button[type="submit"]').click();
  await expect(page.locator('[data-home-now-title]')).toHaveText('Новое дело');
  await expect(page.locator('[data-home-stat="remaining"]')).toHaveText('1');
  await expect(page.locator('.sever2-home-priority')).toBeHidden();
  await expect(page.locator('#todayTasks')).toContainText('Новое дело');
});

test('Home focus action reuses the exact existing linked timer flow without duplicate follow-up chrome', async ({ page }) => {
  const today = isoToday();
  await boot(page, [
    { id: 'focus-home', title: 'Одно важное дело', date: today, time: '', duration: 18, completed: false, category: 'Личное', priority: true, createdAt: 1 }
  ]);

  await expect(page.locator('.sever2-home-priority')).toBeHidden();
  await page.locator('[data-home-action="focus"]').click();
  await expect(page.locator('#timerView')).toBeVisible();
  await expect(page.locator('#timerTaskTitle')).toHaveText('Одно важное дело');
  await expect(page.locator('#timerDisplay')).toHaveText('18:00');
  expect(await page.evaluate(() => window.SeverApp.getContext().activeTimerId)).toBe('focus-home');
});
