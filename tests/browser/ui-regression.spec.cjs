const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'allow'});
async function boot(page){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/supabase-config.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.SEVER_SUPABASE_CONFIG={};'}));
  await page.addInitScript(()=>{if(!localStorage.getItem('sever-anonymous-state-v1'))localStorage.setItem('sever-anonymous-state-v1',JSON.stringify({tasks:[],notes:[],habits:[],folders:[],onboarded:true,appearance:{theme:'aurora',animations:'off',reduceEffects:true}}));});
  await page.goto('/');await expect.poll(()=>page.evaluate(()=>Boolean(window.SeverApp&&navigator.serviceWorker.controller)).catch(()=>false)).toBe(true);
  await page.waitForTimeout(500);await page.waitForFunction(()=>window.SeverApp&&window.SeverNotes);return errors;
}
for(const [width,height] of [[320,568],[360,800],[375,812],[390,844],[393,852],[412,915],[430,932],[768,1024],[1280,720],[1440,900],[1920,1080]]){
  test(`all views and long content fit ${width}x${height}`,async({page})=>{
    await page.setViewportSize({width,height});const errors=await boot(page);
    const check=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);
    for(const view of ['today','calendar','timer','notes','habits','progress','settings']){
      await page.evaluate(v=>window.SeverApp.switchView(v),view);await expect(page.locator('#'+view+'View')).toBeVisible();
      expect(await page.locator('.view').evaluateAll(es=>es.filter(e=>getComputedStyle(e).display!=='none').map(e=>e.id))).toEqual([view+'View']);await check();
    }
    await page.locator('#severAiOpen').click();await expect(page.locator('#severAiInput')).toBeVisible();await check();await page.locator('#severAiClose').click();await expect(page.locator('#severAiPanel')).toBeHidden();
    await page.evaluate(()=>{const a=window.SeverApp,s=a.getState();s.profile.name='Очень длинное имя пользователя без сокращений';const d=new Date().toLocaleDateString('sv-SE');s.tasks=Array.from({length:12},(_,i)=>({id:'visual-'+i,title:'Длинное название задачи с подробностями '.repeat(3),date:d,completed:false,category:'Личное',duration:null}));a.render();a.switchView('today');});await check();
    if(width<=900){
      const geom=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect().toJSON();return{ai:r('#severAiOpen'),nav:r('.bottom-nav'),circle:r('.mobile-create .nav-icon'),tasks:r('#todayTasks'),summary:r('#todayDashboard')};});
      expect(geom.ai.top).toBeGreaterThanOrEqual(0);expect(geom.ai.bottom).toBeLessThanOrEqual(geom.nav.top);expect(geom.ai.width).toBeGreaterThanOrEqual(44);expect(geom.ai.right).toBeLessThanOrEqual(width);expect(Math.abs(geom.circle.width-geom.circle.height)).toBeLessThan(1);expect(geom.tasks.top).toBeLessThan(geom.summary.top);
      await page.locator('#todayTasks .task').last().scrollIntoViewIfNeeded();const last=await page.locator('#todayTasks .task').last().boundingBox();expect(last.y+last.height).toBeLessThanOrEqual(geom.nav.top);
      await page.locator('#mobileCreateBtn').click();await expect(page.locator('#quickAddDialog')).toBeVisible();await check();await page.locator('[data-close="quickAddDialog"]').click();
    }
    expect(errors).toEqual([]);
  });
}
test('task completion, note save, habit check, AI and text zoom keep their flows',async({page})=>{
  const errors=await boot(page);await page.setViewportSize({width:390,height:844});
  await page.locator('#mobileCreateBtn').click();await page.locator('#quickCaptureInput').fill('Проверка задачи');await page.locator('#quickCaptureForm button[type=submit]').click();await page.locator('#todayTasks .check').click();expect(await page.evaluate(()=>window.SeverApp.getState().tasks[0].completed)).toBe(true);
  await page.locator('#mobileQuickNote').click();await page.locator('#quickNoteText').fill('Проверка сохранения');await page.locator('#quickNoteForm .primary').click();expect(await page.evaluate(()=>window.SeverApp.getState().notes.some(n=>n.title==='Проверка сохранения'&&n.body===''))).toBe(true);
  await page.evaluate(()=>window.SeverApp.switchView('habits'));await page.locator('#mobileCreateBtn').click();await page.locator('#quickAddHabit').click();await page.locator('#habitTitle').fill('Проверка привычки');await page.locator('#habitSubmit').click();await page.locator('.habit-week .habit-day:not(:disabled)').last().click();expect(await page.evaluate(()=>Object.values(window.SeverApp.getState().checks).flat().length)).toBe(1);
  await page.evaluate(()=>window.SeverApp.switchView('settings'));await page.addStyleTag({content:'html{font-size:200%}'});await page.locator('#severAiOpen').click();await expect(page.locator('#severAiInput')).toBeVisible();await page.locator('#severAiClose').click();expect(errors).toEqual([]);
});



