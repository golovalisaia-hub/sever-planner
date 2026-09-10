const { test } = require('@playwright/test');
const fs = require('node:fs');

function ensureDir(){ fs.mkdirSync('visual-artifacts', { recursive: true }); }
async function seed(page){
  await page.addInitScript(() => {
    localStorage.setItem('sever-anonymous-state-v1', JSON.stringify({
      version: 11,
      tasks: [
        {id:'visual-1',title:'Изучить Python 30 минут',scheduled_for:new Date().toISOString().slice(0,10),scheduled_time:'18:00',duration_minutes:30,category:'Учёба',priority:true,challenge:false,completed:false,updated_at:new Date().toISOString()},
        {id:'visual-2',title:'Повторить ПДД',scheduled_for:new Date().toISOString().slice(0,10),scheduled_time:'19:00',duration_minutes:30,category:'Учёба',priority:false,challenge:false,completed:true,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}
      ],
      notes: [], folders: [], habits: [], focusSessions: [], onboarded: true
    }));
  });
}

test('capture SEVER 2 desktop visual QA', async ({ browser }) => {
  ensureDir();
  const context = await browser.newContext({ serviceWorkers:'block', viewport:{width:1440,height:900}, deviceScaleFactor:1 });
  const page = await context.newPage();
  await seed(page);
  await page.goto('http://127.0.0.1:41741/');
  await page.screenshot({ path:'visual-artifacts/sever2-desktop-home-1440x900.png', fullPage:true });

  for (const [view, name] of [['calendar','calendar'],['notes','notes'],['timer','timer'],['progress','progress'],['settings','settings']]) {
    await page.locator(`.side-nav [data-view="${view}"]`).click();
    await page.waitForTimeout(120);
    await page.screenshot({ path:`visual-artifacts/sever2-desktop-${name}-1440x900.png`, fullPage:true });
  }
  await context.close();
});

test('capture SEVER 2 mobile visual QA', async ({ browser }) => {
  ensureDir();
  const context = await browser.newContext({ serviceWorkers:'block', viewport:{width:390,height:844}, deviceScaleFactor:1 });
  const page = await context.newPage();
  await seed(page);
  await page.goto('http://127.0.0.1:41741/');
  await page.screenshot({ path:'visual-artifacts/sever2-mobile-home-390x844.png', fullPage:true });
  await context.close();
});
