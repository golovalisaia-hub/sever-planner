const { test, expect } = require('@playwright/test');

function isoToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

async function seed(page) {
  const today = isoToday();
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(({ today }) => {
    const now = Date.now();
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      tasks: [
        { id:'later', title:'Обычная задача', date:today, time:'18:00', duration:20, category:'Личное', completed:false, priority:false, createdAt:now-30 },
        { id:'priority', title:'Главное дело', date:today, time:'20:00', duration:30, category:'Работа', completed:false, priority:true, createdAt:now-20 },
        { id:'early', title:'Раннее дело', date:today, time:'09:00', duration:15, category:'Учёба', completed:false, priority:false, createdAt:now-10 },
        { id:'done', title:'Готовое дело', date:today, time:'08:00', duration:10, category:'Личное', completed:true, completedAt:now, priority:true, createdAt:now-40 },
        { id:'inbox', title:'Разобрать позже', date:'9999-12-31', duration:null, category:'Другое', completed:false, priority:false, createdAt:now }
      ],
      notes: [], folders: [], habits: [], checks: {}, taskMemory: [], profile: { name:'' },
      appearance: { theme:'light', animations:'off', reduceEffects:true }, focusSessions: [], stats:{ focusMs:0, sessions:0 },
      reminders:{ enabled:false, time:'19:00', lastDate:'' }, security:{ protectedNotesAutoLockMinutes:5, lockInBackground:true }, onboarded:true
    }));
    localStorage.setItem('sever-theme','light');
  }, { today });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severHomeFlow === 'ready');
}

test.beforeEach(async ({ page }) => { await seed(page); });

test('Home surfaces one clear daily command block and prioritizes the important task', async ({ page }) => {
  const command = page.locator('#sever2HomeCommand');
  await expect(command).toBeVisible();
  await expect(command.locator('h2')).toHaveText('Главное на сегодня');
  await expect(command).toContainText('3 дела осталось');
  await expect(command.locator('[data-home-inbox] b')).toHaveText('1');

  const rows = command.locator('.sever2-home-priority');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Главное дело');
  await expect(rows.nth(1)).toContainText('Раннее дело');
  await expect(rows.nth(2)).toContainText('Обычная задача');
  await expect(command.locator('.sever2-home-command-progress b')).toHaveText('25%');
});

test('Home Inbox shortcut opens Calendar Inbox without creating another app state', async ({ page }) => {
  await page.locator('#sever2HomeCommand [data-home-inbox]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await expect(page.locator('#todayView')).toBeHidden();
  await expect(page.locator('.sever2-calendar-modes [data-mode="inbox"]')).toHaveClass(/active/);
  await expect(page.locator('#sever2InboxPanel')).toBeVisible();
  await expect(page.locator('#sever2InboxPanel')).toContainText('Разобрать позже');
});

test('Home Add action reuses the existing Create menu and preserves Back behavior', async ({ page }) => {
  await page.locator('#sever2HomeCommand [data-home-create]').click();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await page.locator('#quickAddTask').click();
  await expect(page.locator('#taskDialog')).toBeVisible();
  await page.locator('[data-close="taskDialog"]').click();
  await expect(page.locator('#taskDialog')).toBeHidden();
  await expect(page.locator('#quickAddDialog')).toBeVisible();
});

test('Home command geometry fits narrow phones and desktop', async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const command = await page.locator('#sever2HomeCommand').boundingBox();
  expect(command.x).toBeGreaterThanOrEqual(0);
  expect(command.x + command.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
});
