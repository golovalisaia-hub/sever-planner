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

test('one physical pointer gesture can only consume one task checkbox click even after rerender', () => {
  assert.match(interaction, /let taskPointerSequence = 0/);
  assert.match(interaction, /let taskConsumedSequence = 0/);
  assert.match(interaction, /document\.addEventListener\('pointerdown', guardTaskPointerDown, true\)/);
  assert.match(interaction, /document\.addEventListener\('click', guardTaskClick, true\)/);
  assert.match(interaction, /taskPointerSequence \+= 1/);
  assert.match(interaction, /taskConsumedSequence === taskPointerSequence/);
  assert.match(interaction, /event\.stopImmediatePropagation\(\)/);
  assert.match(interaction, /hardenTaskCheck\(check\)/);
});

test('accepted task checkbox clicks stay isolated from later row interaction layers', () => {
  assert.match(interaction, /check\.addEventListener\('click', event => event\.stopPropagation\(\)\)/);
  assert.match(interaction, /check\.addEventListener\('selectstart', event => event\.preventDefault\(\)\)/);
  assert.match(interaction, /check\.addEventListener\('contextmenu', event => event\.preventDefault\(\)\)/);
});

test('rapid action guard still does not debounce deliberate task completion taps', () => {
  const rapidBody = usability.match(/function rapidClickGuard\(event\) \{([\s\S]*?)\n  \}\n\n  function settingsTitle/)?.[1] || '';
  assert.ok(rapidBody.length > 0, 'rapidClickGuard body should stay discoverable');
  assert.doesNotMatch(rapidBody, /\.task \.check|\.check/);
  assert.match(rapidBody, /Task completion is intentionally NOT debounced/);
});

test('installed PWA receives the v113 task input runtime before the legacy v109 alias', () => {
  assert.match(sw, /const CACHE = 'sever-v126-push-ui-v1'/);
  assert.match(sw, /sever2-interaction-polish\.js\?v=113/);
  assert.match(sw, /v113 hardens iPhone task completion/);
  const current = sw.indexOf('./sever2-interaction-polish.js?v=113');
  const legacy = sw.indexOf('./sever2-interaction-polish.js?v=109');
  assert.ok(current >= 0 && legacy > current, 'v113 must be the first pathname match in the PWA asset list');
});
