import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./browser/beta-functional-sweep-v81.spec.cjs', import.meta.url), 'utf8');

test('beta functional sweep covers every primary SEVER area', () => {
  for (const token of ['today', 'calendar', 'timer', 'notes', 'money', 'progress', 'habits', 'settings']) {
    assert.match(source, new RegExp(`['\"]${token}['\"]`));
  }
  assert.match(source, /completeTimerTask/);
  assert.match(source, /data-plan-today/);
  assert.match(source, /habit-day\.today/);
  assert.match(source, /notes-core-more-items/);
  assert.match(source, /moneyProgressAmount/);
  assert.match(source, /data-sever-theme=\\"motion\\"/);
  assert.match(source, /page\.reload\(\)/);
});
