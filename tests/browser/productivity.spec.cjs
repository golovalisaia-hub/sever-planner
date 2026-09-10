const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.addInitScript(() => {
    const today = new Date().toLocaleDateString('sv-SE');
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: true, tasks: [
        { id:'t1', title:'Первое дело', date:today, time:'10:00', duration:30, category:'Личное', priority:true, challenge:false, completed:false, createdAt:Date.now(), updatedAt:Date.now() },
        { id:'t2', title:'Второе дело', date:today, time:'', duration:15, category:'Работа', priority:false, challenge:false, completed:false, createdAt:Date.now(), updatedAt:Date.now() }
      ], notes:[], folders:[], habits:[], checks:{}, taskMemory:[], profile:{name:''}, appearance:{theme:'light',animations:'off',reduceEffects:true}, focusSessions:[], stats:{focusMs:0,sessions:0}, reminders:{enabled:false,time:'19:00',lastDate:''}, security:{protectedNotesAutoLockMinutes:5,lockInBackground:true}
    }));
    localStorage.setItem('sever-theme','light');
  });
}

test('home gets a compact workload card with one-click focus', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severProductivity)).toBe('ready');
  const card = page.locator('#sever2TodayPlan');
  await expect(card).toBeVisible();
  await expect(card).toContainText('2 дел');
  await expect(card).toContainText('45 мин');
  await expect(card.locator('.sever2-plan-start')).toBeVisible();
});

test('calendar can switch between month and day timeline', async ({ page }) => {
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
});

test('task action exposes quick reschedule and contextual AI', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severProductivity)).toBe('ready');
  await page.locator('#todayTasks .task-open').first().click();
  await expect(page.locator('.sever2-reschedule')).toBeVisible();
  await expect(page.locator('.sever2-reschedule [data-move="today"]')).toBeVisible();
  await expect(page.locator('.sever2-reschedule [data-move="tomorrow"]')).toBeVisible();
  await expect(page.locator('.sever2-ask-ai')).toBeVisible();
});
