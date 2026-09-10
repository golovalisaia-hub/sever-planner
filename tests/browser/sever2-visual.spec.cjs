const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const THEMES = [
  ['light', 'calm'],
  ['motion', 'cozy'],
  ['black', 'focus']
];
const VIEWS = ['today', 'calendar', 'timer', 'notes', 'progress', 'settings'];

async function seed(page) {
  await page.addInitScript(() => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      onboarded: true,
      challengeStart: date,
      challengeDays: 0,
      challengeName: '',
      tasks: [
        { id:'visual-1', title:'Главное дело', date, time:'10:00', duration:45, category:'Личное', priority:true, completed:false, createdAt:1, updatedAt:1 },
        { id:'visual-2', title:'Небольшая задача', date, time:'15:30', duration:20, category:'Другое', priority:false, completed:false, createdAt:2, updatedAt:2 },
        { id:'visual-3', title:'Готово', date, time:'', duration:0, category:'Личное', priority:false, completed:true, completedAt:Date.now(), createdAt:3, updatedAt:3 }
      ],
      notes: [], folders: [], habits: [], checks: {}, taskMemory: [], profile:{name:''},
      appearance:{theme:'light',animations:'off',reduceEffects:true},
      focusSessions:[], stats:{focusMs:0,sessions:0},
      reminders:{enabled:false,time:'19:00',lastDate:''},
      security:{protectedNotesAutoLockMinutes:5,lockInBackground:true}
    }));
    localStorage.setItem('sever-theme','light');
  });
}

test('capture SEVER 2 reference review set', async ({ page }, testInfo) => {
  test.skip(!['phone-390', 'desktop'].includes(testInfo.project.name), 'visual review uses one phone and one desktop');
  await seed(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.SeverApp))).toBe(true);
  await expect(page.locator('link[data-sever2-ui-pack]')).toHaveCount(1);

  const out = path.join(process.cwd(), 'test-results', 'sever2-visual');
  fs.mkdirSync(out, { recursive: true });

  for (const [theme, label] of THEMES) {
    await page.evaluate(() => window.SeverApp.switchView('settings'));
    await page.locator(`.theme-picker [data-sever-theme="${theme}"]`).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    await page.waitForTimeout(80);

    for (const view of VIEWS) {
      await page.evaluate(name => window.SeverApp.switchView(name), view);
      await page.waitForTimeout(50);
      const target = page.locator(`#${view}View`);
      await expect(target).toBeVisible();
      await page.screenshot({
        path: path.join(out, `${testInfo.project.name}-${label}-${view}.png`),
        fullPage: true,
        animations: 'disabled'
      });
    }
  }
});
