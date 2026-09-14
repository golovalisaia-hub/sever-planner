import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// v105 introduced task-scoped rendering. Keep its behavioral contract release-forward
// so later planner-core cache bumps do not turn a healthy release into a stale test failure.
const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

const handler = marker => {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing handler: ${marker}`);
  return source.slice(start, start + 2200);
};

test('v105 task mutations use domain-scoped rendering instead of the full app render', () => {
  assert.match(source, /function saveAndRender\(collections=\['tasks'\]\)\{save\(\);renderChangedCollections\(collections\)\}/);
  assert.doesNotMatch(source, /function saveAndRender\(\)\{save\(\);render\(\)\}/);

  const quick = handler("$('#quickForm').onsubmit");
  assert.match(quick, /renderChangedCollections\(\['tasks'\]\)/);
  assert.doesNotMatch(quick.split("$$('#todayFilters")[0], /\brender\(\)/);

  const form = handler("$('#taskForm').onsubmit");
  assert.match(form, /renderChangedCollections\(\['tasks'\]\)/);
  assert.doesNotMatch(form.split("$('#deleteTask')")[0], /\brender\(\)/);

  const capture = handler("$('#quickCaptureForm').onsubmit");
  assert.match(capture, /renderChangedCollections\(\['tasks'\]\)/);
  assert.doesNotMatch(capture.split("$$('.duration-options")[0], /\brender\(\)/);
});

test('v105 Focus completion updates task and focus domains without rebuilding unrelated views', () => {
  const complete = handler('function completeTask(');
  assert.match(complete, /saveAndRender\(timerCompleted\?\['tasks','focusSessions'\]:\['tasks'\]\)/);

  const tick = handler('function timerTick(');
  assert.match(tick, /else\{save\(\);renderChangedCollections\(\['focusSessions'\]\);renderTimer\(\)/);
  assert.doesNotMatch(tick.split('function render(){')[0], /else\{save\(\);render\(\);renderTimer\(\)/);

  assert.match(source, /if\(changed\.has\('tasks'\)\)\{renderToday\(\);renderCalendar\(\);renderProgress\(\);renderTimerTask\(\)\}/);
  assert.match(source, /if\(changed\.has\('focusSessions'\)\)\{renderToday\(\);renderProgress\(\);renderTimerTask\(\)\}/);
});

test('v105+ PWA ships the task-responsive planner core atomically', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const match = html.match(/<script src="app\.js\?v=(\d+)" defer><\/script>/);
  assert.ok(match, 'planner core script version is present');
  const version = Number(match[1]);
  assert.ok(version >= 105, `planner core version ${version} must preserve v105 responsiveness`);
  assert.ok(sw.includes(`'./app.js?v=${version}'`), 'service worker caches the same planner core version as index.html');
  assert.doesNotMatch(html, /app\.js\?v=51/);
  assert.doesNotMatch(sw, /'\.\/app\.js\?v=51'/);
  assert.match(sw, /v105 scopes hot task mutations to task\/focus rendering/);
});
