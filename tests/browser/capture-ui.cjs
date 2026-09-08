// Read-only visual audit in isolated anonymous contexts. Run the local test server first.
const {chromium}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const sizes=[[320,568],[360,800],[375,812],[390,844],[393,852],[412,915],[430,932],[768,1024],[1280,720],[1440,900],[1920,1080]];
const views=['today','calendar','timer','notes','habits','progress','settings','ai'];
const out=path.resolve(process.argv[2]||'test-results/ui-capture');
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch();const rows=[];
try{for(const [width,height] of sizes){const context=await browser.newContext({viewport:{width,height},serviceWorkers:'allow'});const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/supabase-config.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.SEVER_SUPABASE_CONFIG={};'}));
await page.addInitScript(()=>{if(!localStorage.getItem('sever-anonymous-state-v1'))localStorage.setItem('sever-anonymous-state-v1',JSON.stringify({tasks:[],notes:[],habits:[],folders:[],onboarded:true,appearance:{theme:'aurora',animations:'off',reduceEffects:true}}));});
await page.goto('http://127.0.0.1:41741/');await page.waitForFunction(()=>window.SeverApp&&window.SeverNotes&&navigator.serviceWorker.controller,null,{timeout:15000});
await page.waitForTimeout(700);await page.waitForFunction(()=>window.SeverApp&&navigator.serviceWorker.controller);
for(const view of views){await page.evaluate(v=>window.SeverApp.switchView(v==='ai'?'today':v),view);if(view==='ai')await page.locator('#severAiOpen').click();await page.waitForTimeout(100);
const metrics=await page.evaluate(()=>{const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();return {overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),active:[...document.querySelectorAll('.view')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.id),ai:rect('#severAiOpen'),nav:rect('.bottom-nav'),create:rect('.mobile-create .nav-icon')};});
rows.push({width,height,view,...metrics,errors:[...errors]});await page.screenshot({path:path.join(out,`${width}x${height}-${view}.png`),fullPage:true});if(view==='ai')await page.locator('#severAiClose').click();}
await context.close();console.log(`${width}x${height}: captured`);}}
finally{await browser.close();fs.writeFileSync(path.join(out,'matrix.json'),JSON.stringify(rows,null,2));}})().catch(e=>{console.error(e);process.exitCode=1;});

