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

test('Notes editor recovery loads after Home v85 and before compact Notes polish and cloud recovery', () => {
  const homeIndex = themeInit.indexOf('sever2-home-core-script');
  const coreIndex = themeInit.indexOf('sever2-notes-core-script');
  const organizationIndex = themeInit.indexOf('sever2-notes-organization-script');
  const editorIndex = themeInit.indexOf('sever2-notes-editor-flow-script');
  const navigationIndex = themeInit.indexOf('sever2-notes-navigation-script');
  const polishIndex = themeInit.indexOf('sever2-notes-polish-script');
  const moneyIndex = themeInit.indexOf('sever2-money-script');
  const usabilityIndex = themeInit.indexOf('sever2-usability-v84-script');
  const interactionIndex = themeInit.indexOf('sever2-interaction-polish-script');
  const recoveryIndex = themeInit.indexOf('sever2-cloud-recovery-script');
  assert.ok(homeIndex >= 0 && coreIndex > homeIndex && organizationIndex > coreIndex && editorIndex > organizationIndex && navigationIndex > editorIndex && polishIndex > navigationIndex && moneyIndex > polishIndex && usabilityIndex > moneyIndex && interactionIndex > usabilityIndex && recoveryIndex > interactionIndex);
  assert.match(themeInit, /sever2-home-core\.js\?v=85/);
  assert.match(themeInit, /sever2-notes-editor-flow\.css\?v=73/);
  assert.match(themeInit, /sever2-notes-editor-flow\.js\?v=73/);
  assert.match(themeInit, /sever2-notes-polish\.css\?v=79/);
  assert.match(themeInit, /sever2-notes-polish\.js\?v=79/);
  assert.match(themeInit, /sever2-mobile-consistency\.css\?v=76/);
  assert.match(themeInit, /sever2-money\.js\?v=77/);
  assert.match(themeInit, /sever2-usability-v84\.js\?v=84/);
  assert.match(themeInit, /sever2-interaction-polish\.js\?v=78/);
  assert.match(themeInit, /sever2-cloud-recovery\.js\?v=80/);
  assert.match(sw, /sever2-home-core\.js\?v=85/);
  assert.match(sw, /sever2-notes-editor-flow\.css\?v=90/);
  assert.match(sw, /sever2-notes-editor-flow\.js\?v=73/);
  assert.match(sw, /sever2-notes-navigation\.js\?v=74/);
  assert.match(sw, /sever2-notes-polish\.js\?v=90/);
  assert.match(sw, /sever2-mobile-consistency\.css\?v=76/);
  assert.match(sw, /sever2-money\.js\?v=83/);
  assert.match(sw, /sever2-usability-v84\.js\?v=84/);
  assert.match(sw, /sever2-interaction-polish\.js\?v=78/);
  assert.match(sw, /sever2-cloud-recovery\.js\?v=80/);
  assert.match(sw, /js\/theme-init\.js\?v=85/);
});