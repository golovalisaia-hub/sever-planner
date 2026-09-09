// Real service-worker upgrade from installed pre-design v52 to this release.
const { chromium, expect } = require('@playwright/test');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname,'../..'), baseline = 'b5ade7b3325be577ed84e9cfd11a32bb39d38875';
const out = path.join(root,'.artifacts/release');
const old = new Map(), hash = bytes => createHash('sha256').update(bytes).digest('hex');
let release = 'old';
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  if (!path.resolve(root,file).startsWith(root+path.sep)) return res.writeHead(403).end();
  try {
    let bytes;
    if (release === 'old') {
      if (!old.has(file)) old.set(file,execFileSync('git',['show',`${baseline}:${file}`],{cwd:root,maxBuffer:8*1024*1024,stdio:['ignore','pipe','ignore']}));
      bytes = old.get(file);
    } else bytes = fs.readFileSync(path.join(root,file));
    res.writeHead(200,{'Content-Type':file.endsWith('.js')||file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream','Cache-Control':'no-store'});
    res.end(bytes);
  } catch {res.writeHead(404).end();}
});
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.SEVER_BROWSER_CHANNEL?{channel:process.env.SEVER_BROWSER_CHANNEL}:{});
  const context = await browser.newContext({serviceWorkers:'allow',viewport:{width:390,height:844}});
  try {
    const page = await context.newPage();
    await page.addInitScript(()=>{
      if(!localStorage.getItem('sever-anonymous-state-v1'))localStorage.setItem('sever-anonymous-state-v1',JSON.stringify({
        tasks:[],notes:[],habits:[],onboarded:true,appearance:{theme:'aurora',animations:'off',reduceEffects:true}
      }));
    });
    await page.goto(origin);
    await expect.poll(()=>page.evaluate(()=>Boolean(SeverApp&&navigator.serviceWorker.controller)).catch(()=>false)).toBe(true);
    await page.waitForTimeout(400);
    await expect(page.locator('html')).toHaveAttribute('data-theme','aurora');
    release = 'current';
    // New network assets must not enter the still-installed old app.
    const before = await page.evaluate(async()=>({
      html:await (await fetch('./index.html')).text(),
      app:await (await fetch('./app.js?v=54')).text()
    }));
    expect(before.html).toContain('app.js?v=51');
    expect(hash(Buffer.from(before.app))).toBe(hash(old.get('app.js')));
    await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update()});
    await expect(page.locator('#applyPwaUpdate')).toBeVisible({timeout:30000});
    await page.locator('#applyPwaUpdate').click();
    await expect.poll(()=>page.evaluate(()=>Boolean(window.SeverTheme&&SeverTheme.ids.includes('focus'))).catch(()=>false)).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-theme','focus');
    const assets = await page.evaluate(async()=>{
      const cache=await caches.open('sever-v55-field-sync'),entries=[];
      for(const request of await cache.keys()){
        const bytes=await (await cache.match(request)).arrayBuffer();
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        entries.push({url:request.url,sha256:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')});
      }
      return {entries,keys:await caches.keys()};
    });
    expect(assets.keys).toEqual(['sever-v55-field-sync']);
    for(const entry of assets.entries){
      const name = new URL(entry.url).pathname.slice(1)||'index.html';
      expect(entry.sha256,`mixed release asset: ${name}`).toBe(hash(fs.readFileSync(path.join(root,name))));
    }
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(()=>window.SeverApp);
    await expect(page.locator('html')).toHaveAttribute('data-theme','focus');
    await page.screenshot({path:path.join(out,'pwa-upgraded-offline.png')});
    fs.writeFileSync(path.join(out,'pwa-upgrade.json'),JSON.stringify({
      status:'PASS',from:'sever-v52-ui-stabilization',to:'sever-v55-field-sync',
      oldReleaseRemainedAtomic:true,newReleaseHashesMatch:true,offline:true,...assets
    },null,2));
    console.log(`PASS installed v52 -> v55 update; ${assets.entries.length} asset hashes match; offline reopen`);
  } finally {await context.close();await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
