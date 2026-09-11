import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('sever2-notes-polish.js');
const css = read('sever2-notes-polish.css');

test('Notes polish v79 is syntax-valid and checklist cards are preview-only', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-notes-polish.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.doesNotMatch(js, /expandedChecklists/);
  assert.match(js, /dataset\.notesCompactOpen\s*=\s*'true'/);
  assert.match(js, /window\.SeverNotes\?\.openNote\?\.\(note\)/);
  assert.match(js, /classList\.remove\('notes-polish-checklist-expanded'\)/);
  assert.match(css, /data-notes-compact-checklist="true".*note-check:nth-child\(n\+3\)/s);
  assert.match(css, /display:\s*none\s*!important/);
});

test('mobile Notes editor bounds long checklists and keeps persistent actions', () => {
  assert.match(css, /#noteDialog\.notes-polish-editor/);
  assert.match(css, /height:\s*100dvh\s*!important/);
  assert.match(css, /\.notes-polish-items-editor[\s\S]*max-height:\s*40dvh/);
  assert.match(css, /\.notes-polish-items-editor[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.notes-polish-editor-actions[\s\S]*position:\s*sticky/);
  assert.match(css, /\.notes-polish-editor-actions[\s\S]*bottom:\s*0/);
});
