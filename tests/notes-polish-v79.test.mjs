import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('sever2-notes-polish.js');
const css = read('sever2-notes-polish.css');
const editorCss = read('sever2-notes-editor-flow.css');

test('Notes polish v90 is syntax-valid and More progressively expands checklist cards inline', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-notes-polish.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(js, /const expandedChecklists = new Set\(\)/);
  assert.match(js, /dataset\.notesCompactOpen\s*=\s*'true'/);
  assert.match(js, /expandedChecklists\.add\(note\.id\)/);
  assert.match(js, /expandedChecklists\.delete\(note\.id\)/);
  assert.match(js, /classList\.toggle\('notes-polish-checklist-expanded', expanded\)/);
  assert.doesNotMatch(js, /control\.onclick[\s\S]{0,400}window\.SeverNotes\?\.openNote/s);
  assert.match(css, /data-notes-compact-checklist="true".*note-check:nth-child\(n\+4\)/s);
  assert.match(css, /notes-polish-checklist-expanded[\s\S]*max-height:\s*min\(46dvh, 420px\)/);
  assert.match(css, /notes-polish-checklist-expanded[\s\S]*overflow-y:\s*auto/);
});

test('mobile Notes editor uses one scroll flow and save actions cannot cover checklist rows', () => {
  assert.match(css, /#noteDialog\.notes-polish-editor/);
  assert.match(css, /height:\s*100dvh\s*!important/);
  assert.match(css, /\.notes-polish-items-editor[\s\S]*max-height:\s*none/);
  assert.match(css, /\.notes-polish-items-editor[\s\S]*overflow:\s*visible/);
  assert.match(editorCss, /\.notes-polish-editor-form[\s\S]*padding-bottom:[^;]*!important/);
  assert.match(editorCss, /\.notes-polish-editor-actions[\s\S]*position:\s*static\s*!important/);
  assert.match(editorCss, /\.notes-polish-editor-actions[\s\S]*bottom:\s*auto\s*!important/);
  assert.match(editorCss, /\.notes-polish-editor-actions[\s\S]*backdrop-filter:\s*none\s*!important/);
});
