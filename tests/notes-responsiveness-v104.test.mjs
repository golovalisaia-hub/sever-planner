import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'sever2-notes-responsiveness-v104.js'), 'utf8');
const polish = fs.readFileSync(path.join(root, 'sever2-notes-polish.js'), 'utf8');

test('v104 checklist responsiveness layer is syntax-valid and avoids full Notes rerenders', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-notes-responsiveness-v104.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(source, /root\.addEventListener\('change', onChecklistChange, true\)/);
  assert.match(source, /root\.addEventListener\('click', onBulkClick, true\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /syncCard\(card, note\)/);
  assert.match(source, /requestAnimationFrame\(\(\) =>/);
  assert.match(source, /Promise\.resolve\(save\(\)\)/);
  assert.doesNotMatch(source, /renderNotes\s*\(/);
});

test('v104 never replaces the encrypted protected-note mutation path', () => {
  assert.match(source, /if \(!card \|\| !note \|\| note\.protected\) return/);
  assert.match(source, /Protected notes keep their existing encrypted save path/);
});

test('Notes polish loads the v104 responsiveness layer exactly once', () => {
  assert.match(polish, /function installResponsivenessLayer\(\)/);
  assert.match(polish, /sever2-notes-responsiveness-v104\.js\?v=104/);
  assert.match(polish, /data-sever2-notes-responsiveness-v104-script/);
  assert.match(polish, /installCompactNotesLayer\(\);[\s\S]*installResponsivenessLayer\(\);/);
});
