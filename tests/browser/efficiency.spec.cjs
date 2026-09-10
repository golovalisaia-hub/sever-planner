const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.addInitScript(() => {
    const today = new Date().toLocaleDateString('sv-SE');
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      tasks: [
        { id:'e1', title:'Первое дело', date:today, time:'10:00', duration:25, category:'Личное', priority:false, challenge:false, completed:false, createdAt:Date.now(), updatedAt:Date.now() },
        { id:'e2', title:'Без даты', date:'9999-12-31', time:'', duration:20, category:'Личное', priority:false, challenge:false, completed:false, createdAt:Date.now(), updatedAt:Date.now() }
      ],
      notes:[], folders:[], habits:[], checks:{}, taskMemory:[], profile:{name:''},
      appearance:{theme:'light',animations:'off',reduceEffects:true}, focusSessions:[],
      stats:{focusMs:0,sessions:0}, reminders:{enabled:false,time:'19:00',lastDate:''},
      security:{protectedNotesAutoLockMinutes:5,lockInBackground:true}
    }));
    localStorage.setItem('sever-theme','light');
  });
}

test('Q opens quick add with the title field already focused', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severEfficiency)).toBe('ready');
  await page.keyboard.press('q');
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await expect(page.locator('#quickCaptureInput')).toBeFocused();
});

test('Ctrl+K opens command center and can navigate to Focus', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severEfficiency)).toBe('ready');
  await page.keyboard.press('Control+K');
  await expect(page.locator('#sever2CommandDialog')).toBeVisible();
  await page.locator('#sever2CommandInput').fill('фокус');
  await page.keyboard.press('Enter');
  await expect(page.locator('#timerView')).toBeVisible();
});

test('desktop density preference is persisted without touching planner state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop density control');
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severEfficiency)).toBe('ready');
  const before = await page.evaluate(() => JSON.stringify(window.SeverApp.getState().tasks));
  await page.evaluate(() => window.SeverApp.switchView('settings'));
  await page.locator('#sever2DensitySetting [data-density="compact"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  expect(await page.evaluate(() => localStorage.getItem('sever-density'))).toBe('compact');
  expect(await page.evaluate(() => JSON.stringify(window.SeverApp.getState().tasks))).toBe(before);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
});

test('narrow phones reflow task actions instead of hiding them', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('320') && !testInfo.project.name.includes('360'), 'narrow-phone rule');
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severEfficiency)).toBe('ready');
  await page.evaluate(() => window.SeverApp.switchView('calendar'));
  await page.locator('.sever2-calendar-modes [data-mode="day"]').click();
  const edit = page.locator('.sever2-timeline-task [data-edit]').first();
  await expect(edit).toBeVisible();
  const editBox = await edit.boundingBox();
  expect(editBox.width).toBeGreaterThanOrEqual(40);
  expect(editBox.height).toBeGreaterThanOrEqual(40);

  await page.locator('.sever2-calendar-modes [data-mode="inbox"]').click();
  await expect(page.locator('#sever2InboxPanel [data-plan-tomorrow]').first()).toBeVisible();
  await expect(page.locator('#sever2InboxPanel [data-inbox-edit]').first()).toBeVisible();
});

test('PWA new-task launch intent opens Quick Add and cleans the URL', async ({ page }) => {
  await seed(page);
  await page.goto('/?action=new-task');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.severEfficiency)).toBe('ready');
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await expect(page.locator('#quickCaptureInput')).toBeFocused();
  await expect.poll(() => page.evaluate(() => location.search)).toBe('');
});
