const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.addInitScript(() => {
    const today = new Date().toLocaleDateString('sv-SE');
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: true, tasks: [
        { id:'t1', title:'Первое дело', date:today, time:'10:00', duration:30, category:'Личное', priority:true, challenge:false, completed:false, createdAt:Date.now(), updatedAt:Date.now() },
        { id:'t2', title:'Второе дело', date:today, time:'', duration:15, category:'Работа', priority:false, challenge:false, completed:false, createdAt:Date.now(), updatedAt:Date.now() },
        { id:'t3', title:'Дело без даты', date:'9999-12-31', time:'', duration:20, category:'Личное', priority:false, challenge:false, completed:false, createdAt:Date.now(), updatedAt:Date.now() }
      ], notes:[], folders:[], habits:[], checks:{}, taskMemory:[], profile:{name:''}, appearance:{theme:'light',animations:'off',reduceEffects:true}, focusSessions:[], stats:{focusMs:0,sessions:0}, reminders:{enabled:false,time:'19:00',lastDate:''}, security:{protectedNotesAutoLockMinutes:5,lockInBackground:true}
    }));
    localStorage.setItem('sever-theme','light');
  });
}

async function openCreate(page) {
  const desktop = page.locator('#globalAddBtn');
  if (await desktop.isVisible()) await desktop.click();
  else await page.locator('#mobileCreateBtn').click();
}

async function waitHome(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severHomeFocus)).toBe('ready');
  await expect(page.locator('#sever2HomeFocus')).toBeVisible();
}

test('home summarizes workload and exposes one-click focus in the unified Home', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await waitHome(page);
  await expect(page.locator('#sever2HomeFocusSummary')).toContainText('2 осталось');
  await expect(page.locator('#sever2HomeFocusSummary')).toContainText('45 мин');
  await expect(page.locator('#sever2HomeTopTasks .sever2-home-focus-task')).toHaveCount(2);
  await expect(page.locator('#sever2HomeTopTasks .sever2-home-focus-start').first()).toBeVisible();
  await expect(page.locator('#sever2TodayPlan')).toBeHidden();
});

test('home surfaces unscheduled count without mixing Inbox tasks into today', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await waitHome(page);
  await expect(page.locator('#sever2HomeInboxCount')).toContainText('1 задача без даты');
  await expect(page.locator('#todayTasks .task')).toHaveCount(2);
  await expect(page.locator('#sever2HomeInbox')).toBeHidden();
  await page.locator('#sever2HomeInboxButton').click();
  await expect(page.locator('#sever2InboxPanel')).toContainText('Дело без даты');
});

test('calendar can switch between month, day timeline and Inbox', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severProductivity)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('calendar'));
  await expect(page.locator('.sever2-calendar-modes')).toBeVisible();
  await page.locator('.sever2-calendar-modes [data-mode="day"]').click();
  await expect(page.locator('.sever2-day-panel')).toBeVisible();
  await expect(page.locator('#calendar')).toBeHidden();
  await expect(page.locator('.sever2-timeline-task')).toHaveCount(2);
  await expect(page.locator('#sever2DaySummary')).toContainText('45 мин');

  await page.locator('.sever2-calendar-modes [data-mode="inbox"]').click();
  await expect(page.locator('#sever2InboxPanel')).toBeVisible();
  await expect(page.locator('#sever2InboxPanel .sever2-inbox-task')).toHaveCount(1);
  await expect(page.locator('#sever2InboxPanel')).toContainText('Дело без даты');
});

test('Inbox task can be planned for today through the existing task save path', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severProductivity)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('calendar'));
  await page.locator('.sever2-calendar-modes [data-mode="inbox"]').click();
  await page.locator('#sever2InboxPanel [data-plan-today]').click();
  const today = await page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 't3')?.date)).toBe(today);
  await expect(page.locator('#sever2InboxPanel .sever2-inbox-task')).toHaveCount(0);
});

test('quick create can save a task without a date and persistence survives render', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await waitHome(page);
  await openCreate(page);
  await page.locator('[data-sever2-inbox-date]').click();
  await page.locator('#quickCaptureInput').fill('Новая входящая задача');
  await page.locator('#quickCaptureForm button[type="submit"]').click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.title === 'Новая входящая задача')?.date)).toBe('9999-12-31');
  await expect(page.locator('#quickAddDialog')).toBeHidden();
  await expect(page.locator('#sever2HomeInboxCount')).toContainText('2 задач без даты');
  await page.locator('#sever2HomeInboxButton').click();
  await expect(page.locator('#sever2InboxPanel')).toContainText('Новая входящая задача');
});

test('task action quick-reschedules through the existing save path and exposes contextual AI', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severProductivity)).toBe('ready');
  await page.locator('#todayTasks .task-open').first().click();
  await expect(page.locator('.sever2-reschedule')).toBeVisible();
  await expect(page.locator('.sever2-reschedule [data-move="today"]')).toBeVisible();
  await expect(page.locator('.sever2-reschedule [data-move="tomorrow"]')).toBeVisible();
  await expect(page.locator('.sever2-reschedule [data-move="inbox"]')).toBeVisible();
  await expect(page.locator('.sever2-ask-ai')).toBeVisible();

  const expectedTomorrow = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toLocaleDateString('sv-SE');
  });
  await page.locator('.sever2-reschedule [data-move="tomorrow"]').click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(task => task.id === 't1')?.date)).toBe(expectedTomorrow);
  await expect(page.locator('#taskActionDialog')).toBeHidden();
});

test('timer has an explicit distraction-free focus mode that exits when leaving timer', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severProductivity)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('timer'));
  await expect(page.locator('#sever2FocusTools')).toBeVisible();
  await page.locator('#sever2FocusModeToggle').click();
  await expect(page.locator('body')).toHaveClass(/sever2-focus-immersive/);
  await expect(page.locator('.desktop-sidebar')).toBeHidden();
  await page.evaluate(() => window.SeverApp.switchView('today'));
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('sever2-focus-immersive'))).toBe(false);
});

test('focus queue ranks the day and shows planned versus focused workload', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severFocusFlow)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('timer'));
  const queue = page.locator('#sever2FocusQueue');
  await expect(queue).toBeVisible();
  await expect(queue.locator('.sever2-focus-queue-task')).toHaveCount(2);
  await expect(queue.locator('.sever2-focus-queue-task').first()).toHaveAttribute('data-task-id', 't1');
  await expect(queue).toContainText('45 мин план');
  await expect(queue).toContainText('0 мин фокус');
});

test('active focus task moves to the front, locks context switching and mirrors in the browser title', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severFocusFlow)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('timer'));
  await page.locator('#sever2FocusQueue [data-task-id="t2"] [data-start-focus]').click();
  await expect(page.locator('#timerTaskTitle')).toHaveText('Второе дело');
  await expect.poll(() => page.title()).toContain('Второе дело');
  await expect(page.locator('#sever2FocusQueue .sever2-focus-queue-task').first()).toHaveAttribute('data-task-id', 't2');
  await expect(page.locator('#sever2FocusQueue [data-task-id="t1"] [data-start-focus]')).toBeDisabled();
});
