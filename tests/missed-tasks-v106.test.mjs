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

test('v106 ships missed-task triage and refreshed planner core through the PWA', () => {
  assert.match(html, /sever2-missed-tasks-v106\.css\?v=106/);
  assert.match(html, /app\.js\?v=106/);
  assert.doesNotMatch(html, /app\.js\?v=105/);
  assert.match(sw, /sever-v106-missed-tasks-release-v1/);
  assert.match(sw, /\.\/sever2-missed-tasks-v106\.css\?v=106/);
  assert.match(sw, /\.\/app\.js\?v=106/);
});
