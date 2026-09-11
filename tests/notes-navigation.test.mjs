import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'sever2-notes-navigation.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sever2-notes-navigation.css'), 'utf8');

test('Notes navigation layer is syntax-valid and delegates to existing folder/tag controls', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-notes-navigation.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(source, /folderSource\(\)\?\.querySelector/);
  assert.match(source, /button\.click\(\)/);
  assert.match(source, /document\.querySelector\('#openFolder'\)\?\.click\(\)/);
  assert.match(source, /document\.querySelector\('#manageFolder'\)\?\.click\(\)/);
  assert.doesNotMatch(source, /state\.folders\s*=|state\.notes\s*=/);
});

test('Notes navigation replaces long source rails and keeps search sticky', () => {
  assert.match(css, /\.notes-navigation-source\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(css, /\.notes-navigation-sticky\s*\{[^}]*position:\s*sticky/s);
  assert.match(source, /folders\.classList\.add\('notes-navigation-source'\)/);
  assert.match(source, /tagSource\(\)\?\.classList\.add\('notes-navigation-source'\)/);
  assert.match(source, /dataset\.severNotesNavigation = 'ready'/);
});
