import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('sever2-notes-editor-flow.js');
const themeInit = read('js/theme-init.js');
const sw = read('sw.js');

test('Notes editor recovery is session-only and never uses localStorage for plaintext drafts', () => {
  assert.match(source, /sessionStorage\.setItem\(DRAFT_KEY/);
  assert.match(source, /sessionStorage\.removeItem\(DRAFT_KEY/);
  assert.doesNotMatch(source, /localStorage/);
  assert.match(source, /currentBaseNote\(\)\?\.protected \|\| protectedToggle\?\.checked/);
  assert.match(source, /clearDraft\(\);\s*setStatus\('Защищённый режим · черновик не хранится'/);
});

test('Notes editor recovery distinguishes accidental reloads from a normal close', () => {
  assert.match(source, /let openedNoteId = ''/);
  assert.match(source, /openedNoteId = currentNoteId\(\)/);
  assert.match(source, /draft\.wasOpen = false/);
  assert.match(source, /window\.addEventListener\('pagehide', flushOpenDraft\)/);
  assert.match(source, /if \(!draft\?\.wasOpen/);
});

test('Notes editor recovery loads after Notes core and organization and ships offline', () => {
  const coreIndex = themeInit.indexOf('sever2-notes-core-script');
  const organizationIndex = themeInit.indexOf('sever2-notes-organization-script');
  const editorIndex = themeInit.indexOf('sever2-notes-editor-flow-script');
  const navigationIndex = themeInit.indexOf('sever2-notes-navigation-script');
  assert.ok(coreIndex >= 0 && organizationIndex > coreIndex && editorIndex > organizationIndex && navigationIndex > editorIndex);
  assert.match(themeInit, /sever2-notes-editor-flow\.css\?v=73/);
  assert.match(themeInit, /sever2-notes-editor-flow\.js\?v=73/);
  assert.match(sw, /sever2-notes-editor-flow\.css\?v=73/);
  assert.match(sw, /sever2-notes-editor-flow\.js\?v=73/);
  assert.match(sw, /sever2-notes-navigation\.js\?v=74/);
  assert.match(sw, /js\/theme-init\.js\?v=74/);
});
