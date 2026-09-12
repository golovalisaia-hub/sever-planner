import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('sever2-usability-v84.js');
const css = read('sever2-usability-v84.css');
const loader = read('js/theme-init.js');
const sw = read('sw.js');

test('usability v84 is syntax-valid and removes only pending Money schedule tasks', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-usability-v84.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(source, /function clearPendingSchedule\(item\)/);
  assert.match(source, /!ids\.has\(String\(task\.id\)\) \|\| task\.completed/);
  assert.match(source, /item\.calendarTaskIds = \[\]/);
  assert.match(source, /planningFieldsChanged\(existing\)/);
  assert.match(source, /amount\(item\.currentAmount\) \+ delta >= amount\(item\.targetAmount\)/);
  assert.match(source, /deleteButton\?\.dataset\.confirm === 'true'/);
  assert.match(source, /window\.SeverCloud\?\.capture\?\.\(\)/);
  assert.match(source, /window\.SeverCloud\?\.syncSoon\?\.\(0\)/);
});

test('power-user v91 blocks accidental duplicate actions and progressively discloses rare phone settings', () => {
  assert.match(source, /const RAPID_GUARD_MS = 450/);
  assert.match(source, /function rapidSubmitGuard\(event\)/);
  assert.match(source, /function rapidClickGuard\(event\)/);
  assert.match(source, /stopImmediatePropagation\(\)/);
  assert.match(source, /#timerToggle/);
  assert.match(source, /#moneyScheduleConfirm/);
  assert.match(source, /function mountAdvancedSettings\(\)/);
  assert.match(source, /Безопасность, данные, SEVER AI и сброс/);
  assert.match(source, /document\.documentElement\.dataset\.severPowerUser = 'v91'/);
});

test('guide v84 stays short but explains the rest of SEVER and how to reopen help', () => {
  assert.match(source, /dialog\.dataset\.step !== '5'/);
  assert.match(source, /Всё под рукой/);
  assert.match(source, /Календарь — планы и история/);
  assert.match(source, /Заметки — мысли и чек-листы/);
  assert.match(source, /Деньги и настройки/);
  assert.match(source, /гид всегда можно открыть снова в Настройках/i);
});

test('phone v84 reduces Money and Settings vertical chrome without shrinking touch targets', () => {
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /#settingsView \.settings-appearance \.theme-picker[\s\S]*grid-template-columns: none !important/);
  assert.match(css, /#settingsView \.settings-appearance \.theme-picker[\s\S]*grid-auto-flow: column !important/);
  assert.match(css, /#settingsView \.settings-appearance \.theme-picker[\s\S]*grid-auto-columns: minmax\(154px, 72%\) !important/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /scroll-snap-type: x proximity/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /#moneyView \.money-quick[\s\S]*grid-template-columns: 28px minmax\(0, 1fr\) auto/);
  assert.match(css, /#moneyView \.money-quick > button[\s\S]*min-height: 44px/);
  assert.match(css, /#moneyView \.money-summary[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /#moneyView \.money-summary article:last-child[\s\S]*grid-column: 1 \/ -1/);
  assert.match(css, /#moneyView \.money-add-pills button[\s\S]*min-height: 44px/);
  assert.match(css, /@media \(max-width: 350px\)/);
  assert.match(css, /grid-auto-columns: minmax\(146px, 78%\) !important/);
});

test('v84 and v91 hardening remain after Home v85 in the atomic offline release', () => {
  const home = loader.indexOf('sever2-home-core-script');
  const money = loader.indexOf('sever2-money-script');
  const usability = loader.indexOf('sever2-usability-v84-script');
  const interaction = loader.indexOf('sever2-interaction-polish-script');
  assert.ok(home >= 0 && money > home && usability > money && interaction > usability);
  assert.match(loader, /sever2-home-core\.js\?v=85/);
  assert.match(loader, /sever2-usability-v84\.css\?v=84/);
  assert.match(loader, /sever2-usability-v84\.js\?v=84/);
  assert.match(sw, /const CACHE = 'sever-v92-unified-release-v1'/);
  for (const asset of ['./sever2-home-core.js?v=85', './sever2-usability-v84.css?v=84', './sever2-usability-v84.js?v=84', './sever2-reminders.css?v=86', './js/theme-init.js?v=92']) {
    assert.ok(sw.includes(`'${asset}'`), `missing ${asset}`);
  }
  assert.ok(sw.includes("'/sever2-home-core.js'"));
  assert.ok(sw.includes("'/sever2-usability-v84.css'"));
  assert.ok(sw.includes("'/sever2-usability-v84.js'"));
});