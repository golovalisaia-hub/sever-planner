import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./browser/beta-functional-sweep-v81.spec.cjs', import.meta.url), 'utf8');
const themeInit = fs.readFileSync(new URL('../js/theme-init.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('beta functional sweep covers every primary SEVER area', () => {
  for (const token of ['today', 'calendar', 'timer', 'notes', 'money', 'progress', 'habits', 'settings']) {
    assert.match(source, new RegExp(`['\"]${token}['\"]`));
  }
  assert.match(source, /completeTimerTask/);
  assert.match(source, /data-plan-today/);
  assert.match(source, /habit-day\.today/);
  assert.match(source, /notes-core-more-items/);
  assert.match(source, /moneyProgressAmount/);
  assert.ok(source.includes('[data-sever-theme="motion"]'));
  assert.match(source, /page\.reload\(\)/);
});

test('v81 startup guard remains active inside the complete v93 release cache', () => {
  assert.match(themeInit, /function installServiceWorkerStartupGuard\(\)/);
  assert.match(themeInit, /originalRegister\.apply\(container, args\)/);
  assert.match(themeInit, /return registration \|\| fallbackRegistration/);
  assert.match(themeInit, /continuing without PWA update/);
  assert.match(themeInit, /container\.register !== safeRegister/);
  assert.match(themeInit, /sever2-home-core\.js\?v=85/);
  assert.match(themeInit, /sever2-usability-v84\.js\?v=84/);
  assert.match(sw, /const CACHE = 'sever-v93-complete-release-v1'/);
  assert.match(sw, /sever2-home-core\.js\?v=85/);
  assert.match(sw, /sever2-notes-compact-v87\.js\?v=87/);
  assert.match(sw, /sever2-notes-polish\.js\?v=93/);
  assert.match(sw, /js\/theme-init\.js\?v=92/);
  assert.match(sw, /sever2-usability-v84\.js\?v=84/);
  assert.match(sw, /sever2-reminders\.css\?v=86/);
});