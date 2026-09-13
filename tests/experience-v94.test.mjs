import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('sever2-experience-v94.js');
const css = read('sever2-experience-v94.css');
const notes = read('sever2-notes-compact-v87.js');
const notesCss = read('sever2-notes-compact-v87.css');
const sw = read('sw.js');

test('v101 experience script is syntax-valid and reports cloud state without modal spam', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-experience-v94.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(source, /id = 'severMobileSyncIndicator'/);
  assert.match(source, /role', 'status'/);
  assert.match(source, /aria-live', 'polite'/);
  assert.match(source, /const cloud = window\.SeverCloud/);
  assert.match(source, /cloud\?\.health\?\.\(\)/);
  assert.match(source, /state: 'ok'/);
  assert.match(source, /SEVER синхронизирован/);
  assert.match(source, /Офлайн/);
  assert.match(source, /Изменения сохраняются на устройстве/);
  assert.doesNotMatch(source, /alert\(|confirm\(/);
});

test('v101 selects all four seasons automatically with no forced summer override', () => {
  assert.match(source, /function seasonForMonth\(month\)/);
  assert.match(source, /month === 11 \|\| month <= 1/);
  assert.match(source, /month <= 4/);
  assert.match(source, /month <= 7/);
  assert.match(source, /const season = seasonForMonth\(new Date\(\)\.getMonth\(\)\)/);
  assert.doesNotMatch(source, /SEVER_SEASON_OVERRIDE/);
  assert.match(source, /severSeasonSignature = 'v101'/);
});

test('v101 keeps phone controls touch-safe and makes progress scannable above the fold', () => {
  assert.match(css, /:where\(button, a\[href\], input, select, textarea, summary\):focus-visible/);
  assert.match(css, /\.settings-mobile-index button[\s\S]*min-height:\s*44px\s*!important/);
  assert.match(css, /#progressView \.stats[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /#progressView \.stats > article[\s\S]*min-height:\s*92px\s*!important/);
  assert.match(css, /#noteDialog \.notes-polish-checklist-editor:not\(\.hidden\)[\s\S]*flex:\s*0 0 auto\s*!important/);
  assert.match(css, /#noteDialog \.notes-polish-checklist-editor:not\(\.hidden\)[\s\S]*padding-bottom:\s*22px\s*!important/);
  assert.match(css, /#noteDialog \.note-security,[\s\S]*#noteDialog \.notes-polish-editor-actions[\s\S]*flex:\s*0 0 auto\s*!important/);
});

test('fresh mobile Notes hides organization chrome until there is content', () => {
  assert.match(notes, /function syncLibraryState\(\)/);
  assert.match(notes, /notes-v94-empty-library/);
  assert.match(notes, /dataset\.notesLibraryState = count === 0 \? 'empty' : 'ready'/);
  assert.match(notesCss, /notes-v94-empty-library \.notes-navigation-sticky/);
  assert.match(notesCss, /notes-v94-empty-library \.notes-core-controls/);
  assert.match(notesCss, /display:\s*none !important/);
});

test('v101 reliability assets are part of the atomic offline release', () => {
  assert.match(sw, /const CACHE = 'sever-v94-experience-release-v1'/);
  for (const asset of [
    './sever2-experience-v94.css?v=101',
    './sever2-experience-v94.js?v=101',
    './sever2-interaction-polish.js?v=101'
  ]) {
    assert.ok(sw.includes(`'${asset}'`), `missing ${asset}`);
  }
  assert.ok(sw.includes("'/sever2-experience-v94.css'"));
  assert.ok(sw.includes("'/sever2-experience-v94.js'"));
});
