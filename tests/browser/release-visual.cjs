const { chromium } = require('@playwright/test');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { boot, show, views, geometry } = require('./theme-helpers.cjs');
const sizes = [[320,568],[390,844],[430,932],[768,1024],[1440,900],[1920,1080]];
const themes = ['calm','cozy','focus'];
const out = path.resolve('.artifacts/release/screenshots');
fs.mkdirSync(out, {recursive:true});
const rows = [];
async function audit(page, label, width, height) {
  const data = await page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const nav = document.querySelector('.bottom-nav'), ai = document.querySelector('#severAiOpen');
    const rect = el => el.getBoundingClientRect().toJSON();
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      nav: visible(nav) ? rect(nav) : null, ai: visible(ai) ? rect(ai) : null,
      dialogs: [...document.querySelectorAll('dialog[open]')].map(el => ({ id: el.id, ...rect(el), overflow: el.scrollWidth - el.clientWidth })),
      icons: [...document.querySelectorAll('.bottom-nav .nav-icon svg,#todayDashboard .metric-icon svg,.side-nav svg')].filter(visible).map(rect),
      themeImages: [...document.querySelectorAll('body,.today-hero,.focus-card,.today-focus-widget')].filter(visible).map(el => getComputedStyle(el).backgroundImage),
      brokenImages: [...document.images].filter(el => visible(el) && (!el.complete || el.naturalWidth === 0)).length
    };
  });
  assert.ok(data.overflow <= 0, `${label}: horizontal overflow ${data.overflow}`);
  assert.equal(data.brokenImages, 0, `${label}: broken images`);
  assert.ok(data.themeImages.every(value => !value.includes('url(')), `${label}: legacy artwork`);
  for (const r of data.dialogs) {
    assert.ok(r.left >= -1 && r.right <= width + 1 && r.top >= -1 && r.bottom <= height + 1, `${label}: dialog outside viewport ${r.id}`);
    assert.ok(r.overflow <= 1, `${label}: dialog horizontal overflow ${r.id}`);
  }
  for (const icon of data.icons) assert.ok(icon.width > 0 && icon.height > 0 && icon.width <= 32 && icon.height <= 32, `${label}: malformed icon`);
  if (data.nav) {
    assert.ok(data.nav.bottom <= height + 1, `${label}: bottom nav clipped`);
    if (data.ai) assert.ok(data.ai.bottom <= data.nav.top, `${label}: AI overlaps bottom nav`);
  }
  return data;
}
(async () => {
  const browser = await chromium.launch(process.env.SEVER_BROWSER_CHANNEL ? {channel:process.env.SEVER_BROWSER_CHANNEL} : {});
  try {
    for (const [width,height] of sizes) {
      const baseline = {};
      for (const theme of themes) {
        const context = await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await boot(page, theme);
        for (const view of views) {
          await show(page,view);
          const label = `${theme}-${width}x${height}-${view}`;
          const g = await geometry(page);
          if (theme === 'calm') baseline[view] = g;
          else assert.deepEqual(g,baseline[view],`${label}: theme geometry differs`);
          rows.push({theme,width,height,view,...await audit(page,label,width,height)});
          await page.screenshot({path:path.join(out,`${label}.png`),fullPage:true});
          if (view === 'ai') await page.locator('#severAiClose').click();
        }
        for (const [view,open,dialog] of [
          ['task-dialog',()=>page.evaluate(()=>{SeverApp.switchView('today');document.querySelector('#globalAddBtn').click();document.querySelector('#quickAddTask').click()}),'taskDialog'],
          ['note-dialog',()=>page.evaluate(()=>SeverNotes.openNote()),'noteDialog'],
          ['protected-dialog',async()=>{await page.evaluate(()=>SeverNotes.openNote());await page.locator('#noteProtected').check()},'noteDialog'],
          ['quick-add',()=>page.evaluate(()=>document.querySelector('#globalAddBtn').click()),'quickAddDialog']
        ]) {
          await open();
          await page.waitForTimeout(120);
          const label = `${theme}-${width}x${height}-${view}`;
          rows.push({theme,width,height,view,...await audit(page,label,width,height)});
          await page.screenshot({path:path.join(out,`${label}.png`)});
          await page.locator(`[data-close="${dialog}"]`).click();
        }
        assert.deepEqual(errors,[],`${theme}/${width}: browser errors`);
        await context.close();
        console.log(`PASS ${theme} ${width}x${height}: 8 views + 4 dialogs`);
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out,'matrix.json'),JSON.stringify(rows,null,2));
  }
  fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="ru"><meta charset="utf-8"><title>SEVER 2 release screenshots</title><style>body{font:16px system-ui;background:#f7f4f0;margin:24px}section{margin:48px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}figure{background:white;margin:0;padding:12px}img{width:100%;height:280px;object-fit:contain;object-position:top}nav a{margin-right:20px}</style><h1>SEVER 2 · Final Release Validation</h1><p>216 captures: 3 themes × 6 sizes × (8 views + 4 dialogs).</p><nav>${themes.map(t=>`<a href="#${t}">${t.toUpperCase()}</a>`).join('')}</nav>${themes.map(theme=>`<section id="${theme}"><h2>${theme.toUpperCase()}</h2>${sizes.map(([width,height])=>`<h3>${width}×${height}</h3><div class="grid">${rows.filter(r=>r.theme===theme&&r.width===width).map(r=>{const f=`${theme}-${width}x${height}-${r.view}.png`;return `<figure><figcaption>${r.view}</figcaption><a href="${f}"><img loading="lazy" src="${f}" alt="${f}"></a></figure>`}).join('')}</div>`).join('')}</section>`).join('')}</html>`);
})().catch(e=>{console.error(e);process.exitCode=1});
