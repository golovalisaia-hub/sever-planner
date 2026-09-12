import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('sever2-notes-compact-v87.js');
const css = read('sever2-notes-compact-v87.css');
const polish = read('sever2-notes-polish.js');
const sw = read('sw.js');

test('Notes compact v87 is syntax-valid and reuses existing type filters', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-notes-compact-v87.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(source, /#notesView \.notes-core-filters \[data-notes-core-filter\]/);
  assert.match(source, /id="notesCompactType"/);
  assert.match(source, /Все типы/);
  assert.match(source, /button\?\.click\(\)/);
  assert.match(source, /MutationObserver\(syncSelect\)/);
  assert.match(source, /dataset\.severNotesCompact = 'v87'/);
});

test('Notes compact v87 is mobile-only and keeps 44px controls', () => {
  assert.match(css, /\.notes-compact-type\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /#notesView > \.view-intro\s*\{\s*display:\s*none/);
  assert.match(css, /#notesView \.notes-core-filters\s*\{\s*display:\s*none !important/);
  assert.match(css, /#notesView \.notes-compact-type[\s\S]*display:\s*block/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /#notesView:has\(#noteList > \.empty\) \.notes-core-summary/);
});

test('Notes compact v87 is loaded by Notes polish and ships atomically offline in v93', () => {
  assert.match(polish, /sever2-notes-compact-v87\.css\?v=87/);
  assert.match(polish, /sever2-notes-compact-v87\.js\?v=87/);
  assert.match(sw, /const CACHE = 'sever-v93-complete-release-v1'/);
  for (const asset of ['./sever2-notes-compact-v87.css?v=87', './sever2-notes-compact-v87.js?v=87']) {
    assert.ok(sw.includes(`'${asset}'`), `missing ${asset}`);
  }
  assert.ok(sw.includes("'/sever2-notes-compact-v87.css'"));
  assert.ok(sw.includes("'/sever2-notes-compact-v87.js'"));
});
