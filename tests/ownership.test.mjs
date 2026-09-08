import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const notes = fs.readFileSync(new URL('../notes-pro.js', import.meta.url), 'utf8');
test('core planner functions have one declaration and no runtime replacement', () => {
  for (const name of ['taskElement', 'completeTask', 'timerTick', 'renderProgress', 'render', 'startTimer', 'switchView', 'migrate', 'freshState']) {
    assert.equal((app.match(new RegExp(`^function ${name}\\(`, 'gm')) || []).length, 1, name);
    assert.doesNotMatch(app + '\n' + notes, new RegExp(`^${name}\\s*=`, 'm'), name);
  }
});
test('notes module owns note rendering and editing', () => {
  assert.doesNotMatch(app, /^function (renderNotes|openNote)\(/m);
  assert.doesNotMatch(notes, /originalFreshState|originalMigrate/);
  assert.match(notes, /function renderNotes\(/);
  assert.match(notes, /async function openNote\(/);
});
