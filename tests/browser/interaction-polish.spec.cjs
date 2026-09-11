const { test, expect } = require('@playwright/test');

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function boot(page) {
  const today = isoToday();
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(seed => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      tasks: [
        { id: 'pdd-task', title: 'ПДД', date: seed, time: null, duration: 30, completed: false, category: 'Личное', priority: false, createdAt: 1 }
      ],
      notes: [], folders: [],
      habits: [{ id: 'pullups', title: 'Подтягивание', createdAt: 1, updatedAt: 1 }],
      checks: { pullups: [] }, taskMemory: [],
      profile: { name: 'ADMIN' },
      appearance: { theme: 'light', animations: 'off', reduceEffects: true },
      focusSessions: [], stats: { focusMs: 0, sessions: 0 },
      reminders: { enabled: false, time: '19:00', lastDate: '' },
      security: { protectedNotesAutoLockMinutes: 5, lockInBackground: true }, onboarded: true
    }));
    localStorage.setItem('sever-theme', 'light');
  }, today);
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severInteractionPolish === 'ready');
}

async function setTheme(page, theme) {
  await page.evaluate(value => {
    localStorage.setItem('sever-theme', value);
    document.documentElement.dataset.theme = value;
  }, theme);
  await page.waitForTimeout(50);
}

function closeEnough(a, b, tolerance = 1.5) {
  return Math.abs(a - b) <= tolerance;
}

test.beforeEach(async ({ page }) => { await boot(page); });

test('task completion shows a real checkmark and remains reversible in every theme', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('today'));
  const task = page.locator('#todayTasks .task').first();
  const check = task.locator('.check');
  await expect(task).toBeVisible();

  for (const theme of ['light', 'motion', 'black']) {
    await setTheme(page, theme);
    await expect(check).toHaveAttribute('aria-pressed', 'false');
    await check.click();
    await expect(task).toHaveClass(/\bdone\b/);
    await expect(check).toHaveAttribute('aria-pressed', 'true');

    const completed = await check.evaluate(el => {
      const pseudo = getComputedStyle(el, '::after');
      return {
        content: pseudo.content,
        right: parseFloat(pseudo.borderRightWidth),
        bottom: parseFloat(pseudo.borderBottomWidth),
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
      };
    });
    expect(completed.content).not.toBe('none');
    expect(completed.right).toBeGreaterThan(0);
    expect(completed.bottom).toBeGreaterThan(0);
    expect(completed.overflow).toBeLessThanOrEqual(1);

    await check.click();
    await expect(task).not.toHaveClass(/\bdone\b/);
    await expect(check).toHaveAttribute('aria-pressed', 'false');
  }
});

test('habit completion keeps edit button and seven-day geometry stable in every theme', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('habits'));
  const habit = page.locator('#habitList .habit').first();
  await expect(habit).toBeVisible();

  for (const theme of ['light', 'motion', 'black']) {
    await setTheme(page, theme);
    const today = habit.locator('.habit-day.today');
    await expect(today).toBeVisible();

    const before = await habit.evaluate(el => {
      const edit = el.querySelector('.habit-edit').getBoundingClientRect();
      const week = el.querySelector('.habit-week').getBoundingClientRect();
      const today = el.querySelector('.habit-day.today').getBoundingClientRect();
      return { edit: { x: edit.x, y: edit.y, width: edit.width, height: edit.height }, week: { x: week.x, width: week.width }, today: { x: today.x, y: today.y, width: today.width, height: today.height } };
    });

    await today.click();
    await expect(habit).toHaveClass(/\bdone\b/);
    await expect(today).toHaveClass(/\bdone\b/);
    await expect(today).toHaveAttribute('aria-pressed', 'true');

    const after = await habit.evaluate(el => {
      const edit = el.querySelector('.habit-edit').getBoundingClientRect();
      const week = el.querySelector('.habit-week').getBoundingClientRect();
      const today = el.querySelector('.habit-day.today').getBoundingClientRect();
      const editStyle = getComputedStyle(el.querySelector('.habit-edit'));
      return {
        edit: { x: edit.x, y: edit.y, width: edit.width, height: edit.height, background: editStyle.backgroundColor },
        week: { x: week.x, width: week.width },
        today: { x: today.x, y: today.y, width: today.width, height: today.height },
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
      };
    });

    expect(after.edit.width).toBeGreaterThanOrEqual(43);
    expect(after.edit.height).toBeGreaterThanOrEqual(43);
    expect(closeEnough(before.edit.x, after.edit.x, 2)).toBe(true);
    expect(closeEnough(before.edit.y, after.edit.y, 2)).toBe(true);
    expect(closeEnough(before.week.x, after.week.x, 2)).toBe(true);
    expect(closeEnough(before.week.width, after.week.width, 2)).toBe(true);
    expect(closeEnough(before.today.x, after.today.x, 2)).toBe(true);
    expect(closeEnough(before.today.width, after.today.width, 2)).toBe(true);
    expect(closeEnough(before.today.height, after.today.height, 2)).toBe(true);
    expect(after.overflow).toBeLessThanOrEqual(1);

    await today.click();
    await expect(habit).not.toHaveClass(/\bdone\b/);
  }
});

test('calendar separates today from task presence instead of drawing two today badges', async ({ page }) => {
  await page.evaluate(() => window.SeverApp.switchView('calendar'));
  await expect(page.locator('#calendarView')).toBeVisible();

  for (const theme of ['light', 'motion', 'black']) {
    await setTheme(page, theme);
    const today = page.locator('#calendar > .day.today');
    const status = today.locator('.sever2-v78-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('1');

    const geometry = await today.evaluate(cell => {
      const dateBadge = cell.querySelector(':scope > span').getBoundingClientRect();
      const status = cell.querySelector('.sever2-v78-status');
      const statusRect = status.getBoundingClientRect();
      return {
        tag: status.tagName,
        date: { left: dateBadge.left, right: dateBadge.right, top: dateBadge.top, bottom: dateBadge.bottom },
        status: { left: statusRect.left, right: statusRect.right, top: statusRect.top, bottom: statusRect.bottom, width: statusRect.width, height: statusRect.height },
        overlap: !(statusRect.right <= dateBadge.left || statusRect.left >= dateBadge.right || statusRect.bottom <= dateBadge.top || statusRect.top >= dateBadge.bottom),
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
      };
    });

    expect(geometry.tag).toBe('DIV');
    expect(geometry.status.height).toBeLessThanOrEqual(16);
    expect(geometry.status.width).toBeLessThan(32);
    expect(geometry.overlap).toBe(false);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
  }
});

test('Focus Peak uses one centered Home focus action and timer ring stays inside the phone viewport', async ({ page }, info) => {
  if (info.project.name === 'desktop') test.skip();
  await setTheme(page, 'black');
  await page.evaluate(() => window.SeverApp.switchView('today'));
  await expect(page.locator('#todayFocusWidget')).toBeHidden();
  const focus = page.locator('#sever2HomeCore [data-home-action="focus"]');
  await expect(focus).toBeVisible();

  const home = await focus.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const icon = el.querySelector('svg').getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      width: rect.width,
      height: rect.height,
      display: style.display,
      alignItems: style.alignItems,
      justifyContent: style.justifyContent,
      iconCenterX: icon.left + icon.width / 2,
      buttonCenterX: rect.left + rect.width / 2,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth)
    };
  });
  expect(home.width).toBeGreaterThanOrEqual(44);
  expect(home.height).toBeGreaterThanOrEqual(44);
  expect(home.display).toBe('flex');
  expect(home.alignItems).toBe('center');
  expect(home.justifyContent).toBe('center');
  expect(Math.abs(home.iconCenterX - home.buttonCenterX)).toBeLessThan(home.width / 3);
  expect(home.overflow).toBeLessThanOrEqual(1);

  await focus.click();
  await expect(page.locator('#timerView')).toBeVisible();
  const ring = await page.locator('#timerView .timer-ring').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth) };
  });
  expect(ring.left).toBeGreaterThanOrEqual(0);
  expect(ring.right).toBeLessThanOrEqual(ring.viewport);
  expect(ring.width).toBeGreaterThan(150);
  expect(ring.overflow).toBeLessThanOrEqual(1);
});
