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

test('Notes compact layer is syntax-valid and reuses existing type filters', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-notes-compact-v87.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(source, /#notesView \.notes-core-filters \[data-notes-core-filter\]/);
  assert.match(source, /id="notesCompactType"/);
  assert.match(source, /Все типы/);
  assert.match(source, /button\?\.click\(\)/);
  assert.match(source, /MutationObserver\(syncSelect\)/);
  assert.match(source, /dataset\.severNotesCompact = 'v94'/);
  assert.match(source, /notes-v94-empty-library/);
  assert.match(source, /dataset\.notesLibraryState/);
});

test('Notes compact layer is mobile-only, touch-safe and progressively discloses organization', () => {
  assert.match(css, /\.notes-compact-type\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /#notesView > \.view-intro\s*\{\s*display:\s*none/);
  assert.match(css, /#notesView \.notes-core-filters\s*\{\s*display:\s*none !important/);
  assert.match(css, /#notesView \.notes-compact-type[\s\S]*display:\s*block/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /notes-v94-empty-library \.notes-navigation-sticky/);
  assert.match(css, /notes-v94-empty-library \.notes-core-controls/);
  assert.match(css, /notes-v94-empty-library \.notes-core-summary/);
});

test('Notes compact layer and v94 experience pack ship atomically offline', () => {
  assert.match(polish, /sever2-notes-compact-v87\.css\?v=87/);
  assert.match(polish, /sever2-notes-compact-v87\.js\?v=87/);
  assert.match(source, /sever2-experience-v94\.css\?v=94/);
  assert.match(source, /sever2-experience-v94\.js\?v=94/);
  assert.match(sw, /const CACHE = 'sever-v94-experience-release-v1'/);
  for (const asset of [
    './sever2-notes-compact-v87.css?v=87', './sever2-notes-compact-v87.js?v=87',
    './sever2-experience-v94.css?v=94', './sever2-experience-v94.js?v=94'
  ]) assert.ok(sw.includes(`'${asset}'`), `missing ${asset}`);
  for (const pathValue of [
    '/sever2-notes-compact-v87.css','/sever2-notes-compact-v87.js',
    '/sever2-experience-v94.css','/sever2-experience-v94.js'
  ]) assert.ok(sw.includes(`'${pathValue}'`), `missing ${pathValue}`);
});