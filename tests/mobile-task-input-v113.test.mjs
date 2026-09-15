import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const interaction = read('sever2-interaction-polish.js');
const usability = read('sever2-usability-v84.js');
const sw = read('sw.js');

test('task controls disable native iOS text selection and callout', () => {
  assert.match(interaction, /-webkit-user-select:\s*none\s*!important/);
  assert.match(interaction, /user-select:\s*none\s*!important/);
  assert.match(interaction, /-webkit-touch-callout:\s*none\s*!important/);
  assert.match(interaction, /\.task \.check,[\s\S]*touch-action:\s*manipulation/);
});

test('one physical pointer gesture can only consume one task checkbox click', () => {
  assert.match(interaction, /const taskCheckGestures = new WeakMap\(\)/);
  assert.match(interaction, /check\.addEventListener\('pointerdown'/);
  assert.match(interaction, /gesture\.sequence \+= 1/);
  assert.match(interaction, /gesture\.consumed === gesture\.sequence/);
  assert.match(interaction, /event\.stopImmediatePropagation\(\)/);
  assert.match(interaction, /event\.stopPropagation\(\)/);
  assert.match(interaction, /hardenTaskCheck\(check\)/);
});

test('rapid action guard still does not debounce deliberate task completion taps', () => {
  const rapidTarget = usability.match(/function rapidClickGuard\(event\)[\s\S]*?const target =([\s\S]*?): null;/)?.[1] || '';
  assert.doesNotMatch(rapidTarget, /\.check/);
  assert.match(usability, /Task completion is intentionally NOT debounced/);
});

test('installed PWA receives the v113 task input runtime', () => {
  assert.match(sw, /const CACHE = 'sever-v113-mobile-task-input-v1'/);
  assert.match(sw, /sever2-interaction-polish\.js\?v=113/);
  assert.match(sw, /v113 hardens iPhone task completion/);
});
