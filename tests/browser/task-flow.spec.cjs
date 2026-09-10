const { test, expect } = require('@playwright/test');

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function boot(page, tasks = []) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType:'text/javascript', body:'window.SEVER_SUPABASE_CONFIG={};' }));
  const today = todayISO();
  await page.addInitScript(({ today, tasks }) => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version:11,onboarded:true,challengeStart:today,challengeDays:0,challengeName:'',tasks,notes:[],folders:[],habits:[],checks:{},taskMemory:[],
      profile:{name:''},appearance:{theme:'light',animations:'off',reduceEffects:true},focusSessions:[],stats:{focusMs:0,sessions:0},
      reminders:{enabled:false,time:'19:00',lastDate:''},security:{protectedNotesAutoLockMinutes:5,lockInBackground:true}
    }));
    localStorage.setItem('sever-theme','light');
  }, { today, tasks });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && window.SeverTaskFlow && document.documentElement.dataset.severTaskFlow === 'ready');
  return today;
}

async function openDetailedTask(page) {
  await page.evaluate(() => document.querySelector('#globalAddBtn').click());
  await expect(page.locator('#quickAddDialog')).toBeVisible();
  await page.locator('#quickAddTask').click();
  await expect(page.locator('#taskDialog')).toBeVisible();
}

test('Study suggests Focus and saves the timer in existing duration field', async ({ page }) => {
  await boot(page);
  await openDetailedTask(page);
  await page.locator('#taskTitle').fill('Разобрать новую тему');
  await page.locator('#taskCategory').selectOption('Учёба');
  await expect(page.locator('#taskForm')).toHaveAttribute('data-sever-execution-mode','focus');
  await expect(page.locator('#taskDuration').locator('xpath=..')).toBeVisible();
  await expect(page.locator('#taskTime').locator('xpath=..')).toBeHidden();
  await expect(page.locator('#taskDuration')).toHaveValue('30');
  await page.locator('#taskForm .primary').click();
  await expect(page.locator('#taskDialog')).toBeHidden();
  const task = await page.evaluate(() => window.SeverApp.getState().tasks.find(item => item.title === 'Разобрать новую тему'));
  expect(task.category).toBe('Учёба');
  expect(task.time).toBe('');
  expect(task.duration).toBe(30);
  expect(Object.prototype.hasOwnProperty.call(task,'executionMode')).toBe(false);
});

test('Errand suggests scheduled time and does not attach a focus timer', async ({ page }) => {
  await boot(page);
  await openDetailedTask(page);
  await page.locator('#taskTitle').fill('Забрать заказ');
  await page.locator('#taskCategory').selectOption('Дела');
  await expect(page.locator('#taskForm')).toHaveAttribute('data-sever-execution-mode','scheduled');
  await expect(page.locator('#taskTime').locator('xpath=..')).toBeVisible();
  await expect(page.locator('#taskDuration').locator('xpath=..')).toBeHidden();
  await expect(page.locator('#taskTime')).toHaveAttribute('required','');
  await page.locator('#taskTime').fill('18:40');
  await page.locator('#taskForm .primary').click();
  const task = await page.evaluate(() => window.SeverApp.getState().tasks.find(item => item.title === 'Забрать заказ'));
  expect(task.category).toBe('Дела');
  expect(task.time).toBe('18:40');
  expect(task.duration).toBeNull();
});

test('Other tasks let the user explicitly choose flexible, focus or scheduled behavior', async ({ page }) => {
  await boot(page);
  await openDetailedTask(page);
  await page.locator('#taskTitle').fill('Своя задача');
  await page.locator('#taskCategory').selectOption('Другое');
  await page.locator('#severTaskModeField [data-task-mode="focus"]').click();
  await page.locator('#taskDuration').fill('45');
  await page.locator('#taskForm .primary').click();
  let task = await page.evaluate(() => window.SeverApp.getState().tasks.find(item => item.title === 'Своя задача'));
  expect(task.duration).toBe(45); expect(task.time).toBe('');

  await page.evaluate(() => document.querySelector('#globalAddBtn').click());
  await page.locator('#quickAddTask').click();
  await page.locator('#taskTitle').fill('Без привязки');
  await page.locator('#taskCategory').selectOption('Другое');
  await page.locator('#severTaskModeField [data-task-mode="flexible"]').click();
  await page.locator('#taskForm .primary').click();
  task = await page.evaluate(() => window.SeverApp.getState().tasks.find(item => item.title === 'Без привязки'));
  expect(task.duration).toBeNull(); expect(task.time).toBe('');
});

test('Quick create exposes simple, focus and scheduled choices without changing cloud schema', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.querySelector('#globalAddBtn').click());
  await page.locator('#quickCaptureInput').fill('Быстрый фокус');
  await page.locator('#severQuickModeField [data-quick-mode="focus"]').click();
  await page.locator('#severQuickFocusMinutes').selectOption('45');
  await page.locator('#quickCaptureForm .primary').click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(item => item.title === 'Быстрый фокус')?.duration)).toBe(45);

  await page.evaluate(() => document.querySelector('#globalAddBtn').click());
  await page.locator('#quickCaptureInput').fill('Выехать');
  await page.locator('#severQuickModeField [data-quick-mode="scheduled"]').click();
  await page.locator('#severQuickTime').fill('16:15');
  await page.locator('#quickCaptureForm .primary').click();
  await expect.poll(() => page.evaluate(() => window.SeverApp.getState().tasks.find(item => item.title === 'Выехать')?.time)).toBe('16:15');
  const scheduled = await page.evaluate(() => window.SeverApp.getState().tasks.find(item => item.title === 'Выехать'));
  expect(scheduled.duration).toBeNull();
  expect(Object.prototype.hasOwnProperty.call(scheduled,'executionMode')).toBe(false);
});

test('Home starts Focus tasks but scheduled and flexible tasks open the task action instead', async ({ page }, info) => {
  const today = todayISO();
  await boot(page, [
    {id:'focus',title:'Учебная сессия',date:today,time:'',duration:30,category:'Учёба',priority:true,completed:false,createdAt:1,updatedAt:1},
    {id:'scheduled',title:'Поехать за заказом',date:today,time:'17:30',duration:null,category:'Дела',priority:false,completed:false,createdAt:2,updatedAt:2},
    {id:'flex',title:'Разобрать вещи',date:today,time:'',duration:null,category:'Личное',priority:false,completed:false,createdAt:3,updatedAt:3}
  ]);
  await expect(page.locator('#sever2HomeTopTasks [data-task-id="focus"]')).toHaveAttribute('data-execution-mode','focus');
  await expect(page.locator('#sever2HomeTopTasks [data-task-id="scheduled"]')).toHaveAttribute('data-execution-mode','scheduled');
  await expect(page.locator('#sever2HomeTopTasks [data-task-id="flex"]')).toHaveAttribute('data-execution-mode','flexible');
  await expect(page.locator('#sever2HomeTopTasks [data-task-id="scheduled"] .sever2-home-focus-copy small')).toContainText('17:30');

  await page.locator('#sever2HomeTopTasks [data-task-id="scheduled"] .sever2-home-focus-start').click();
  await expect(page.locator('#taskActionDialog')).toBeVisible();
  await expect(page.locator('#taskActionStart')).toHaveText('Готово');
  await expect(page.locator('#timerView')).toBeHidden();
  await page.locator('[data-close="taskActionDialog"]').first().click();

  await page.locator('#sever2HomeTopTasks [data-task-id="focus"] .sever2-home-focus-start').click();
  await expect(page.locator('#timerView')).toBeVisible();
  await expect(page.locator('#timerTaskTitle')).toContainText('Учебная сессия');

  if (info.project.name !== 'desktop') {
    await page.evaluate(() => window.SeverApp.switchView('today'));
    for (const button of await page.locator('#severTaskModeField [data-task-mode]').all()) {
      const box = await button.boundingBox(); if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
});
