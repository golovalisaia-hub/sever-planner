const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

function safeName(value) {
  return String(value || 'project').replace(/[^a-z0-9_-]+/gi, '-');
}

async function seed(page) {
  await page.route('**/supabase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.SEVER_SUPABASE_CONFIG={};' }));
  await page.addInitScript(() => {
    const pad = value => String(value).padStart(2, '0');
    const toIso = offset => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() + offset);
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const now = Date.now();
    const habits = [
      { id: 'visual-python', title: 'Python · 30 минут', createdAt: now - 60 * 86400000, updatedAt: now },
      { id: 'visual-pdd', title: 'ПДД · 30 минут', createdAt: now - 60 * 86400000, updatedAt: now },
      { id: 'visual-reading', title: 'Чтение', createdAt: now - 32 * 86400000, updatedAt: now }
    ];
    const checks = {
      'visual-python': [0,-1,-2,-3,-5,-6,-8,-9,-10,-12,-14,-15,-17,-18,-20,-23,-24,-27,-29].map(toIso),
      'visual-pdd': [-1,-2,-4,-5,-7,-8,-11,-13,-14,-16,-19,-21,-22,-25,-28].map(toIso),
      'visual-reading': [0,-3,-6,-9,-12,-15,-18,-21,-24,-27].map(toIso)
    };
    const tasks = [
      { id:'visual-missed', title:'ПТД полчаса', date:toIso(-1), time:'', duration:30, category:'Учёба', priority:false, challenge:false, completed:false, completedAt:null, createdAt:now-86400000, updatedAt:now-86400000 },
      { id:'visual-done-1', title:'Python · глава и практика', date:toIso(-1), time:'18:00', duration:30, category:'Учёба', priority:true, challenge:false, completed:true, completedAt:now-80000000, createdAt:now-90000000, updatedAt:now-80000000 },
      { id:'visual-today-1', title:'Разобрать заметки SEVER', date:toIso(0), time:'19:30', duration:25, category:'Личное', priority:false, challenge:false, completed:false, completedAt:null, createdAt:now, updatedAt:now },
      { id:'visual-today-2', title:'30 минут ПДД', date:toIso(0), time:'20:00', duration:30, category:'Учёба', priority:true, challenge:false, completed:true, completedAt:now-1200000, createdAt:now-5000000, updatedAt:now-1200000 }
    ];
    for (let offset = -2; offset >= -28; offset -= 2) {
      tasks.push({
        id:`visual-history-${offset}`,
        title:`История ${Math.abs(offset)}`,
        date:toIso(offset),
        time:'',
        duration:20,
        category:'Личное',
        priority:false,
        challenge:false,
        completed:Math.abs(offset) % 4 !== 0,
        completedAt:Math.abs(offset) % 4 !== 0 ? now + offset * 86400000 : null,
        createdAt:now + offset * 86400000,
        updatedAt:now
      });
    }
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version:11,
      onboarded:true,
      tourSeen:true,
      tasks,
      notes:[],
      folders:[],
      habits,
      checks,
      taskMemory:[],
      profile:{ name:'' },
      appearance:{ theme:'black', animations:'off', reduceEffects:true },
      focusSessions:[
        { id:'vf1', durationMinutes:45, startedAt:now-1*86400000, completedAt:now-1*86400000, status:'completed', createdAt:now, updatedAt:now },
        { id:'vf2', durationMinutes:30, startedAt:now-3*86400000, completedAt:now-3*86400000, status:'completed', createdAt:now, updatedAt:now },
        { id:'vf3', durationMinutes:20, startedAt:now-8*86400000, completedAt:now-8*86400000, status:'completed', createdAt:now, updatedAt:now }
      ],
      stats:{ focusMs:95*60000, sessions:3 },
      reminders:{ enabled:false, time:'19:00', lastDate:'' },
      security:{ protectedNotesAutoLockMinutes:5, lockInBackground:true }
    }));
    localStorage.setItem('sever-theme', 'black');
  });
  await page.goto('/');
  await page.waitForFunction(() => window.SeverApp && document.documentElement.dataset.severProgressHabits === 'ready');
}

async function shot(page, projectName, label) {
  // Keep review images outside Playwright's managed test-results directory.
  // Playwright may clean successful-test output before the workflow upload step.
  const out = path.resolve('visual-review/sever2-v109');
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, `${safeName(projectName)}-${label}.png`), fullPage: true });
}

test('v109 visual review captures Today, Habits history and Progress', async ({ page }, testInfo) => {
  await seed(page);
  const project = testInfo.project.name;

  await page.evaluate(() => window.SeverApp.switchView('today'));
  await expect(page.locator('#missedTasksBlock')).toBeVisible();
  await expect(page.locator('#missedTasksBlock .missed-check').first()).toHaveText('');
  await shot(page, project, 'today-missed');

  await page.evaluate(() => window.SeverApp.switchView('habits'));
  await expect(page.locator('#sever109HabitHistoryBar')).toBeVisible();
  await expect(page.locator('#habitList .sever109-habit-metrics')).toHaveCount(3);
  await shot(page, project, 'habits-current');

  await page.locator('#sever109HabitHistoryBar [data-week="prev"]').click();
  await expect(page.locator('#habitList .sever109-history-week')).toHaveCount(3);
  await shot(page, project, 'habits-previous');

  await page.evaluate(() => window.SeverApp.switchView('progress'));
  await expect(page.locator('#sever109ProgressSummary')).toBeVisible();
  await expect(page.locator('#sever109HabitProgress .sever109-habit-progress-row')).toHaveCount(3);
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(page, project, 'progress');
});
