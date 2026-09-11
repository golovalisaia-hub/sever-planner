const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.addInitScript(() => {
    const dayISO = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const add = days => { const date = new Date(); date.setDate(date.getDate()+days); return dayISO(date); };
    const now = Date.now();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks: [
        { id:'c1', title:'Главное дело', date:add(0), time:'10:00', duration:25, category:'Личное', priority:true, challenge:false, completed:false, createdAt:now, updatedAt:now },
        { id:'c2', title:'Выполненное дело', date:add(0), time:'12:00', duration:15, category:'Личное', priority:false, challenge:false, completed:true, createdAt:now, updatedAt:now },
        { id:'c3', title:'Следующий шаг', date:add(1), time:'16:00', duration:20, category:'Личное', priority:false, challenge:false, completed:false, createdAt:now, updatedAt:now }
      ],
      notes:[], folders:[], habits:[], checks:{}, taskMemory:[], profile:{name:''},
      appearance:{theme:'light',animations:'off',reduceEffects:true}, focusSessions:[],
      stats:{focusMs:0,sessions:0}, reminders:{enabled:false,time:'19:00',lastDate:''},
      security:{protectedNotesAutoLockMinutes:5,lockInBackground:true}
    }));
    localStorage.setItem('sever-theme','light');
  });
}

test('month cells expose task status and phone history shows what happened on each day', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'phone history surface');
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severInteractionPolish)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('calendar'));

  const todayCell = page.locator('#calendar > .day.today');
  await expect(todayCell).toHaveAttribute('data-sever-task-count', '2');
  const status = todayCell.locator('.sever2-day-status.sever2-v78-status');
  await expect(status).toHaveCount(1);
  await expect(status.locator('.sever2-v78-task-dot')).toHaveCount(1);
  await expect(status).toContainText('2');
  await expect(page.locator('#sever2MonthHistory')).toBeVisible();
  await expect(page.locator('#sever2MonthHistory')).toContainText('Главное дело');
  await expect(page.locator('#sever2MonthHistory')).toContainText('Выполненное дело');
  await expect(page.locator('#sever2MonthHistory')).toContainText('Следующий шаг');

  await page.locator('.sever2-calendar-modes [data-mode="day"]').click();
  await expect(page.locator('#sever2MonthHistory')).toBeHidden();
  await expect(page.locator('.sever2-day-panel')).toBeVisible();
  await page.locator('.sever2-calendar-modes [data-mode="inbox"]').click();
  await expect(page.locator('#sever2MonthHistory')).toBeHidden();
  await expect(page.locator('#sever2InboxPanel')).toBeVisible();
  await page.locator('.sever2-calendar-modes [data-mode="month"]').click();
  await expect(page.locator('#sever2MonthHistory')).toBeVisible();

  await page.locator('#sever2MonthHistory [data-history-date]').first().click();
  await expect(page.locator('#dayDialog')).toBeVisible();
});

test('desktop keeps inline calendar titles while the phone-only history stays out of the layout', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop calendar behavior');
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severCalendarClarity)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('calendar'));

  await expect(page.locator('#sever2MonthHistory')).toBeHidden();
  await expect(page.locator('#calendar > .day.today u').first()).toBeVisible();
  await expect(page.locator('#sever2CalendarToday')).toBeVisible();
});

test('Today returns calendar navigation to the current month without changing planner data', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severCalendarClarity)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('calendar'));
  const before = await page.evaluate(() => JSON.stringify(window.SeverApp.getState().tasks));
  const currentTitle = await page.locator('#monthTitle').textContent();

  await page.locator('#nextMonth').click();
  await expect(page.locator('#monthTitle')).not.toHaveText(currentTitle);
  await page.locator('#sever2CalendarToday').click();
  await expect(page.locator('#monthTitle')).toHaveText(currentTitle);
  expect(await page.evaluate(() => JSON.stringify(window.SeverApp.getState().tasks))).toBe(before);
});
