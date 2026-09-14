import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('sever2-efficiency.css');
const efficiency = read('sever2-efficiency.js');
const app = read('app.js');
const sw = read('sw.js');

test('v102 desktop keeps one command surface and one explicit create action', () => {
  assert.match(css, /v102 desktop simplification/);
  assert.match(css, /\.topbar \.global-command\{display:none!important\}/);
  assert.match(css, /\.topbar \.sever2-command-open[\s\S]*grid-column:2!important/);
  assert.match(css, /\.topbar \.sever2-command-open span::after[\s\S]*content:"Поиск и команды"/);
  assert.match(css, /#severAiOpen\.sever-ai-launch\{display:none!important\}/);
  assert.match(css, /body:has\(#tourDialog\[open\]\) \.topbar \.global-command\{display:flex!important/);
  assert.match(efficiency, /button\.title = 'Поиск и команды · Ctrl\+K'/);
  assert.match(efficiency, /<kbd>Ctrl K<\/kbd>/);
});

test('desktop Ctrl K is captured by the single command center before legacy Quick Add', () => {
  assert.match(efficiency, /window\.matchMedia\('\(min-width: 901px\)'\)\.matches/);
  assert.match(efficiency, /event\.stopImmediatePropagation\(\)/);
  assert.match(efficiency, /openCommandCenter\(\)/);
  assert.match(efficiency, /document\.addEventListener\('keydown',[\s\S]*\}, true\);/);
  assert.match(app, /openGlobalCreate/);
});

test('command options stay mounted while the pointer moves so clicks cannot chase detached buttons', () => {
  assert.match(efficiency, /function syncActive\(\)/);
  assert.match(efficiency, /button\.addEventListener\('mouseenter',[\s\S]*syncActive\(\)/);
  assert.doesNotMatch(efficiency, /button\.addEventListener\('mousemove',[\s\S]*render\(\)/);
  assert.match(efficiency, /ArrowDown[\s\S]*syncActive\(\)/);
  assert.match(efficiency, /ArrowUp[\s\S]*syncActive\(\)/);
});

test('v102 Home removes duplicate rail Quick Note and gives habit rhythm readable cells', () => {
  assert.match(css, /body:has\(#todayView\.view\.active\) \.desktop-rail \.quick-note-card\{display:none!important\}/);
  assert.match(css, /\.desktop-habit-summary \.habit-week-markers \.habit-day[\s\S]*height:31px!important/);
  assert.match(css, /\.habit-day:empty::before[\s\S]*content:attr\(data-day\)/);
});

test('timer progress remains data-driven and v102 makes the changing arc visually explicit', () => {
  assert.match(app, /progress=total\?timerLeft\/total:0/);
  assert.match(app, /timerProgress'\)\.style\.strokeDashoffset=490\.09\*\(1-progress\)/);
  assert.match(css, /#timerView \.timer-progress[\s\S]*stroke-dasharray:490\.09!important/);
  assert.match(css, /#timerView \.timer-progress[\s\S]*transition:stroke-dashoffset \.25s linear!important/);
  const timerRule = css.match(/#timerView \.timer-progress\{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(timerRule, /stroke-dashoffset\s*:/, 'CSS must not override the JS-computed timer offset');
});

test('v102 desktop polish remains in the current atomic PWA release', () => {
  const release = sw.match(/const CACHE = 'sever-v(\d+)-[^']+'/);
  assert.ok(release && Number(release[1]) >= 102, 'current atomic cache must preserve v102 desktop polish');
  assert.ok(sw.includes("'./sever2-efficiency.css?v=102'"));
  assert.ok(sw.includes("'./sever2-efficiency.js?v=102'"));
  assert.ok(sw.includes("'/sever2-efficiency.css'"));
  assert.ok(sw.includes("'/sever2-efficiency.js'"));
});
