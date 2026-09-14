import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('sever2-progress-habits-v109.js');
const css = read('sever2-progress-habits-v109.css');
const polish = read('sever2-interaction-polish.js');
const sw = read('sw.js');

test('v109 progress and habit layer parses and is loaded atomically', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-progress-habits-v109.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(polish, /installProgressHabitsV109Layer\(\)/);
  assert.match(polish, /sever2-progress-habits-v109\.css\?v=109/);
  assert.match(polish, /sever2-progress-habits-v109\.js\?v=109/);
  const release = sw.match(/const CACHE = 'sever-v(\d+)-[^']+'/);
  assert.ok(release && Number(release[1]) >= 109, 'current atomic cache must preserve the v109 progress layer');
  assert.ok(sw.includes("'./sever2-progress-habits-v109.css?v=109'"));
  assert.ok(sw.includes("'./sever2-progress-habits-v109.js?v=109'"));
  assert.ok(sw.includes("'/sever2-progress-habits-v109.css'"));
  assert.ok(sw.includes("'/sever2-progress-habits-v109.js'"));
});

test('missed tasks are visually pending instead of pretending to be completed', () => {
  assert.match(js, /function polishMissedTasks\(\)/);
  assert.match(js, /if \(button\.textContent\) button\.textContent = ''/);
  assert.match(js, /button\.dataset\.state = 'pending'/);
  assert.match(js, /button\.setAttribute\('aria-pressed', 'false'\)/);
  assert.match(js, /Отметить пропущенную задачу выполненной/);
  assert.match(css, /#missedTasksBlock \.missed-check \{/);
  assert.match(css, /background:\s*transparent !important/);
  assert.match(css, /font-size:\s*0 !important/);
  assert.match(css, /\.missed-head-copy small::after/);
  assert.match(css, /НЕ ВЫПОЛНЕНО/);
});

test('habit history exposes previous weeks plus current, best and 30-day regularity', () => {
  assert.match(js, /let habitWeekOffset = 0/);
  assert.match(js, /function habitCurrentStreak\(habit\)/);
  assert.match(js, /function habitBestStreak\(habit\)/);
  assert.match(js, /function habitThirtyDayRate\(habit\)/);
  assert.match(js, /function aggregateHabitRate\(\)/);
  assert.match(js, /data-week="prev"/);
  assert.match(js, /data-week="next"/);
  assert.match(js, /data-week="current"/);
  assert.match(js, /Прошлая неделя · история сохранена/);
  assert.match(js, /sever109-habit-metric streak/);
  assert.match(css, /\.sever109-habit-metric\.history::before[\s\S]*content:\s*"30д"/);
});

test('progress tab gets dense 30-day task, habit, streak and weekly focus signals', () => {
  assert.match(js, /data-metric="tasks"/);
  assert.match(js, /data-metric="habits"/);
  assert.match(js, /data-metric="streak"/);
  assert.match(js, /data-metric="focus"/);
  assert.match(js, /function taskRate\(days = 30\)/);
  assert.match(js, /function focusMinutesBetween\(start, end\)/);
  assert.match(js, /Последние 30 дней/);
  assert.match(js, /for \(let offset = 29; offset >= 0; offset -= 1\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(30, minmax\(3px, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

test('calendar day dialog is refreshed after task state and Undo interactions', () => {
  assert.match(js, /function installDayDialogRepair\(\)/);
  assert.match(js, /#dayTaskList \.check, #toast button/);
  assert.match(js, /window\.SeverApp\?\.getContext\?\.\(\)\.selectedDate/);
  assert.match(js, /dialog\.close\(\)/);
  assert.match(js, /cell\.click\(\)/);
});

test('desktop SEVER wordmark and autumn flight are intentionally larger without touching phone rules', () => {
  assert.match(css, /@media \(min-width: 901px\)/);
  assert.match(css, /\.desktop-sidebar > \.wordmark \{[\s\S]*font-size:\s*44px !important/);
  assert.match(css, /sever109-autumn-desktop-a/);
  assert.match(css, /translate3d\(102px,6px,0\)/);
  assert.match(css, /sever109-autumn-desktop-b/);
  assert.match(css, /translate3d\(104px,-3px,0\)/);
  assert.match(css, /sever109-autumn-desktop-c/);
  assert.match(css, /translate3d\(106px,5px,0\)/);
  for (const name of ['a','b','c']) {
    const block = css.match(new RegExp(`@keyframes sever109-autumn-desktop-${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] || '';
    assert.ok(block, `missing desktop autumn keyframes ${name}`);
    assert.doesNotMatch(block, /\bleft\s*:/);
    assert.doesNotMatch(block, /\btop\s*:/);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none !important/);
});