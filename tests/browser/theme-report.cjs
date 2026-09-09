// Generate a local screenshot index and fail if any pre-stage geometry changed.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const out = path.resolve('.artifacts/themes');
const baseline = JSON.parse(fs.readFileSync(path.join(out, 'baseline.json')));
const rows = JSON.parse(fs.readFileSync(path.join(out, 'geometry.json')));
assert.equal(rows.length, 48);
for (const row of rows) {
  const before = baseline.find(b => b.width === row.width && b.height === row.height && b.view === row.view);
  assert.deepEqual(row.geometry, before.geometry, `${row.theme}/${row.width}/${row.view}: baseline geometry changed`);
}
fs.writeFileSync(path.join(out, 'layout-verification.json'), JSON.stringify({
  baseline: 'b5ade7b3325be577ed84e9cfd11a32bb39d38875', status: 'PASS', combinations: rows.length,
  note: 'All sampled rectangles equal the pre-stage layout (0.01 CSS px precision).'
}, null, 2));
const names = { calm: 'Calm Balance', cozy: 'Cozy Mood', focus: 'Focus Peak' };
const views = { today: 'Home', calendar: 'Calendar', timer: 'Timer', notes: 'Notes', habits: 'Habits', progress: 'Progress', settings: 'Settings', ai: 'AI' };
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="ru"><meta charset="utf-8">
<title>SEVER 2 · Stage 4 screenshots</title>
<style>body{font:16px system-ui;margin:32px;background:#f7f4f0;color:#292623}nav{display:flex;gap:24px}section{margin-top:48px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}figure{margin:0;padding:14px;background:white;border-radius:12px}img{width:100%;height:320px;object-fit:contain;object-position:top}figcaption{margin-bottom:12px}a{color:inherit}h3{margin-top:32px}</style>
<h1>SEVER 2 · Multi-theme system</h1><p>3 themes × 8 views × 2 sizes · 48 screenshots. Click an image for its full resolution.</p>
<p>Baseline geometry: PASS — all sampled rectangles unchanged.</p>
<nav>${Object.entries(names).map(([id, name]) => `<a href="#${id}">${name}</a>`).join('')}</nav>
${Object.entries(names).map(([theme, name]) => `<section id="${theme}"><h2>${name}</h2>${[390, 1440].map(width => `<h3>${width} × ${width === 390 ? 844 : 900}</h3><div class="grid">${rows.filter(r => r.theme === theme && r.width === width).map(r => {
  const file = `${theme}-${r.width}x${r.height}-${r.view}.png`;
  return `<figure><figcaption>${views[r.view]}</figcaption><a href="${file}"><img src="${file}" loading="lazy" alt="${name} ${views[r.view]} ${r.width}"></a></figure>`;
}).join('')}</div>`).join('')}</section>`).join('')}</html>`);
console.log('PASS: 48/48 baseline geometry comparisons; screenshot gallery generated.');
