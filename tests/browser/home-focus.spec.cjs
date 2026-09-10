const { test, expect } = require('@playwright/test');

function dayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  const today = dayISO();
  await page.addInitScript(({ today }) => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11, onboarded: true, challengeStart: today, challengeDays: 0, challengeName: '',
      tasks: [
        { id:'normal-late', title:'Обычная поздняя', date:today, time:'18:00', duration:20, category:'Личное', completed:false, priority:false, createdAt:3 },
        { id:'priority', title:'Самое важное', date:today, time:'20:00', duration:30, category:'Учёба', completed:false, priority:true, createdAt:2 },
        { id:'normal-early', title:'Обычная ранняя', date:today, time:'10:00', duration:15, category:'Другое', completed:false, priority:false, createdAt:1 },
        { id:'done', title:'Готовая', date:today, time:'09:00', duration:10, category:'Личное', completed:true, priority:true, createdAt:0 },
        { id:'inbox', title:'Без даты', date:'9999-12-31', duration:null, category:'Личное', completed:false, priority:false, createdAt:4 }
      ],
      notes: [], folders: [], habits: [], checks: {}, taskMemory: [], profile: { name:'' },
      appearance: { theme:'light', animations:'off', reduceEffects:true }, focusSessions: [], stats: { focusMs:0, sessions:0 },
      reminders: { enabled:false, time:'19:00', lastDate:'' }, security: { protectedNotesAutoLockMinutes:5, lockInBackground:true }
    }));
    localStorage.setItem('sever-theme','light');
  }, { today });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverNotes);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severHomeFocus)).toBe('ready');
});

test('Home is one focused surface without duplicated legacy sections or planner mutations', async ({ page }) => {
  const before = await page.evaluate(() => JSON.stringify(window.SeverApp.getState()));
  await expect(page.locator('#sever2HomeFocus')).toBeVisible();
  await expect(page.locator('#todayView')).toHaveClass(/sever2-home-simple/);
  for (const selector of ['.today-hero','.today-motivation','.course-card','#quickForm','#todayDashboard','#todayFocusWidget','.today-quote','.sever2-today-plan','.sever2-home-inbox','.today-list-head','#todayFilters','#todayTasks','.today-utilities']) {
    await expect(page.locator(`#todayView ${selector}`).first()).toBeHidden();
  }
  const titles = await page.locator('#sever2HomeTopTasks .sever2-home-focus-copy b').allTextContents();
  expect(titles).toEqual(['Самое важное','Обычная ранняя','Обычная поздняя']);
  await expect(page.locator('#sever2HomeFocusSummary')).toContainText('3 осталось');
  await expect(page.locator('#sever2HomeFocusSummary')).toContainText('1 готово');
  await expect(page.locator('#sever2HomeInboxCount')).toContainText('1 задача без даты');
  await expect(page.locator('#sever2HomeQuickNoteButton')).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(window.SeverApp.getState()))).toBe(before);
});

test('Home keeps Create, Inbox, Focus and Quick note as direct actions', async ({ page }, info) => {
  if (info.project.name !== 'desktop') {
    const createBox = await page.locator('#sever2HomeCreate').boundingBox();
    expect(createBox).not.toBeNull();
    expect(createBox.height).toBeGreaterThanOrEqual(44);
  }

  await page.locator('#sever2HomeCreate').click();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await page.locator('[data-close="quickAddDialog"]').click();

  await page.locator('#sever2HomeInboxButton').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await expect(page.locator('#sever2InboxPanel')).toBeVisible();
  await expect(page.locator('#sever2InboxPanel')).toContainText('Без даты');

  await page.evaluate(() => window.SeverApp.switchView('today'));
  await page.locator('#sever2HomeQuickNoteButton').click();
  await expect(page.locator('#quickNoteDialog')).toBeVisible();
  await page.locator('[data-close="quickNoteDialog"]').click();

  await page.locator('#sever2HomeFocusButton').click();
  await expect(page.locator('#timerView')).toBeVisible();
});
