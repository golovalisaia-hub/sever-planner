import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('v106 keeps overdue task history instead of silently rewriting dates', () => {
  assert.doesNotMatch(app, /t\.date=TODAY;moved\+\+/);
  assert.doesNotMatch(app, /Перенесено на сегодня: \$\{moved\}/);
  assert.match(app, /function missedTasks\(\)/);
  assert.match(app, /function renderMissedTasks\(\)/);
  assert.match(app, /data-missed-action/);
});

test('v106 missed-task triage remains in the current atomic PWA release', () => {
  assert.match(html, /sever2-missed-tasks-v106\.css\?v=106/);
  assert.match(html, /app\.js\?v=106/);
  assert.doesNotMatch(html, /app\.js\?v=105/);
  const release = sw.match(/const CACHE = 'sever-v(\d+)-[^']+'/);
  assert.ok(release && Number(release[1]) >= 106, 'current atomic cache must preserve v106 missed-task triage');
  assert.match(sw, /\.\/sever2-missed-tasks-v106\.css\?v=106/);
  assert.match(sw, /\.\/app\.js\?v=106/);
});
