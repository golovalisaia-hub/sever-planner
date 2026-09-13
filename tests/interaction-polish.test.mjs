import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('sever2-interaction-polish.js');
const css = read('sever2-interaction-polish.css');
const usability = read('sever2-usability-v84.js');
const themeInit = read('js/theme-init.js');
const sw = read('sw.js');

test('interaction polish keeps the original task checkbox size and centered completion mark', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-interaction-polish.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  const taskCheckRule = css.match(/\.task \.check \{[^}]*\}/)?.[0] || '';
  const taskDoneCheckRule = css.match(/\.task\.done \.check \{[^}]*\}/)?.[0] || '';
  assert.match(taskCheckRule, /width:\s*28px/);
  assert.match(taskCheckRule, /height:\s*28px/);
  assert.doesNotMatch(taskCheckRule, /44px/);
  assert.match(taskDoneCheckRule, /background:\s*var\(--accent/);
  assert.match(css, /\.task\.done \.check::after \{[\s\S]*position:\s*absolute[\s\S]*left:\s*50%[\s\S]*top:\s*50%/);
  assert.match(css, /width:\s*7px[\s\S]*height:\s*12px/);
  assert.match(css, /transform:\s*translate\(-50%, -58%\) rotate\(45deg\) !important/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /-webkit-tap-highlight-color:\s*transparent/);
  assert.match(source, /check\.setAttribute\('aria-pressed', String\(done\)\)/);
  assert.match(source, /Задача выполнена/);
  assert.match(usability, /Task completion is intentionally NOT debounced/);
  assert.doesNotMatch(usability, /closest\('\.task \.check, \.habit-day/);
});

test('v96.3 retires Money schedule reminders synchronously before the Money save persists', () => {
  assert.match(source, /function guardMoneyLifecycleSubmit\(event\)/);
  assert.match(source, /function clearPendingMoneySchedule\(item\)/);
  assert.match(source, /!ids\.has\(String\(task\.id\)\) \|\| task\.completed/);
  assert.match(source, /item\.calendarTaskIds = \[\]/);
  assert.match(source, /moneyPlanningFieldsChanged\(item\)/);
  assert.match(source, /amount\(item\.currentAmount\) \+ delta >= amount\(item\.targetAmount\)/);
  assert.match(source, /document\.addEventListener\('submit', guardMoneyLifecycleSubmit, true\)/);
  assert.match(source, /dataset\.severMoneyLifecycle = 'v96\.3'/);
});

test('autumn wordmark sends three transparent orange leaves across SEVER and remains motion-safe', () => {
  assert.match(css, /Autumn signature: three soft orange leaves cross the wordmark/);
  assert.match(css, /color:\s*#d97932 !important/);
  assert.match(css, /\.sever-season-mark\[data-season="autumn"\] > svg/);
  assert.match(css, /\.sever-season-mark\[data-season="autumn"\]::before/);
  assert.match(css, /\.sever-season-mark\[data-season="autumn"\]::after/);
  assert.match(css, /@keyframes sever-autumn-flight-a/);
  assert.match(css, /@keyframes sever-autumn-flight-b/);
  assert.match(css, /@keyframes sever-autumn-flight-c/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none !important/);
});

test('calendar task status no longer becomes a second today badge', () => {
  assert.match(source, /document\.createElement\('div'\)/);
  assert.match(source, /sever2-day-status sever2-v78-status/);
  assert.match(css, /#calendar > \.day\.today > \.sever2-day-status/);
  assert.match(css, /\.sever2-v78-status \.sever2-v78-task-dot/);
  assert.match(css, /\.sever2-v78-status\.all-done/);
});

test('calendar polish recovers when a later presentation layer replaces a day status', () => {
  assert.match(source, /function calendarNeedsPolish\(\)/);
  assert.match(source, /cell\.querySelector\(':scope > \.sever2-v78-status'\)/);
  assert.match(source, /calendarObserver\.observe\(calendar, \{ childList: true, subtree: true \}\)/);
  assert.match(source, /if \(rebuilt \|\| calendarNeedsPolish\(\)\) scheduleCalendar\(\)/);
  assert.match(source, /querySelectorAll\(':scope > \.sever2-day-status'\)\.forEach/);
});

test('habit completion cannot restyle the whole card and Focus play stays centered', () => {
  assert.match(css, /\.habit\.done \.habit-edit/);
  assert.match(css, /\.habit\.done \.habit-week \.habit-day/);
  assert.match(css, /\.habit \.habit-week \.habit-day\.done/);
  assert.match(css, /html\[data-theme="black"\] #todayView \.today-focus-widget \.primary/);
  assert.match(css, /place-items:\s*center/);
  assert.match(css, /border-left:\s*11px solid currentColor/);
});

test('v97 interaction polish remains inside the atomic v101 reliability PWA release', () => {
  const home = themeInit.indexOf('sever2-home-core-script');
  const money = themeInit.indexOf('sever2-money-script');
  const usabilityIndex = themeInit.indexOf('sever2-usability-v84-script');
  const polish = themeInit.indexOf('sever2-interaction-polish-script');
  const recovery = themeInit.indexOf('sever2-cloud-recovery-script');
  assert.ok(home >= 0 && money > home && usabilityIndex > money && polish > usabilityIndex && recovery > polish);
  assert.match(themeInit, /sever2-home-core\.js\?v=85/);
  assert.match(themeInit, /sever2-usability-v84\.css\?v=84/);
  assert.match(themeInit, /sever2-usability-v84\.js\?v=84/);
  assert.match(themeInit, /sever2-interaction-polish\.css\?v=78/);
  assert.match(themeInit, /sever2-interaction-polish\.js\?v=78/);
  assert.match(themeInit, /sever2-cloud-recovery\.js\?v=80/);
  assert.match(themeInit, /data-\$\{marker\}.*v80/s);
  assert.match(sw, /const CACHE = 'sever-v101-reliability-release-v1'/);
  for (const asset of [
    './sever2-home-core.js?v=85',
    './sever2-notes-polish.css?v=92','./sever2-notes-polish.js?v=93',
    './sever2-notes-compact-v87.css?v=87','./sever2-notes-compact-v87.js?v=87',
    './sever2-experience-v94.css?v=101','./sever2-experience-v94.js?v=101',
    './sever2-money.css?v=83','./sever2-money.js?v=83',
    './sever2-usability-v84.css?v=93','./sever2-usability-v84.js?v=84',
    './sever2-interaction-polish.css?v=97','./sever2-interaction-polish.js?v=101',
    './sever2-cloud-recovery.css?v=80','./sever2-cloud-recovery.js?v=80',
    './sever2-reminders.css?v=86','./sever2-task-reminders.js?v=82',
    './js/theme-init.js?v=92'
  ]) assert.ok(sw.includes(`'${asset}'`), `missing ${asset}`);
  for (const pathValue of [
    'sever2-home-core.js','sever2-usability-v84.css','sever2-usability-v84.js',
    'sever2-interaction-polish.css','sever2-interaction-polish.js','sever2-cloud-recovery.js',
    'sever2-reminders.css','sever2-task-reminders.js','sever2-experience-v94.css','sever2-experience-v94.js'
  ]) assert.match(sw, new RegExp(`'/${pathValue.replaceAll('.', '\\.').replaceAll('-', '\\-')}'`));
});
