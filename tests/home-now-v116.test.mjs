import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('v116 Home uses the same morning/day/evening language as notification rhythm', async () => {
  const source = await read('sever2-home-core.js');
  assert.match(source, /СТАРТ ДНЯ/);
  assert.match(source, /РИТМ ДНЯ/);
  assert.match(source, /ЗАКРОЕМ ДЕНЬ/);
  assert.match(source, /minutes < 14 \* 60/);
  assert.match(source, /minutes < 20 \* 60 \+ 30/);
});

test('v116 chooses an actionable task, then a habit, then a calm completed state', async () => {
  const source = await read('sever2-home-core.js');
  assert.match(source, /isTaskActionableNow/);
  assert.match(source, /scheduled <= current \+ 60/);
  assert.match(source, /const actionableTask = pending\.find\(task => isTaskActionableNow\(task\)\) \|\| null/);
  assert.match(source, /const nextHabit = !nextTask \? \(pendingHabits\[0\] \|\| null\) : null/);
  assert.match(source, /habitDoneToday/);
  assert.match(source, /title\.textContent = 'День закрыт'/);
  assert.match(source, /Отдых тоже часть ритма/);
});

test('v116 prefers clearing inbox over adding more work when the day is otherwise empty', async () => {
  const source = await read('sever2-home-core.js');
  assert.match(source, /title\.textContent = 'Разберём входящие'/);
  assert.match(source, /data-home-action="inbox-primary"/);
  assert.match(source, /inbox-primary'\) goInbox\(\)/);
});

test('v116 keeps one primary Home action and moves detail density behind native disclosure', async () => {
  const source = await read('sever2-home-core.js');
  const css = await read('sever2-home-core.css');
  assert.match(source, /<details class="sever2-home-plan" data-home-plan>/);
  assert.match(source, /<summary><span><b>План дня<\/b>/);
  assert.doesNotMatch(source, /<details[^>]*\sopen(?:\s|>)/);
  assert.match(source, /data-home-action="focus"/);
  assert.match(source, /data-home-action="habit"/);
  assert.match(source, /data-home-action="create"/);
  assert.doesNotMatch(source, /sever2-home-now-actions[\s\S]{0,900}data-home-action="tasks"/);
  assert.match(css, /\.sever2-home-plan>summary/);
  assert.match(css, /\.sever2-home-plan\[open\] \.sever2-home-plan-arrow/);
  assert.match(css, /#todayView \.sever2-home-plan:not\(\[open\]\) > \.sever2-home-plan-body\s*\{\s*display:none!important\s*\}/);
});

test('v116 keeps readiness stable while exposing an explicit runtime version', async () => {
  const source = await read('sever2-home-core.js');
  assert.match(source, /dataset\.severHomeCore = 'ready'/);
  assert.match(source, /dataset\.severHomeCoreVersion = 'v116'/);
});

test('v116 unifies task and habit completion into one day progress summary', async () => {
  const source = await read('sever2-home-core.js');
  assert.match(source, /const totalUnits = items\.length \+ habits\.length/);
  assert.match(source, /const doneUnits = completedTasks \+ completedHabits/);
  assert.match(source, /const remainingUnits = pending\.length \+ pendingHabits\.length/);
  assert.match(source, /data-home-plan-summary/);
});

test('service worker serves v116 Home before the legacy v85 aliases', async () => {
  const sw = await read('sw.js');
  const cssCurrent = sw.indexOf("./sever2-home-core.css?v=116");
  const cssLegacy = sw.indexOf("./sever2-home-core.css?v=85");
  const jsCurrent = sw.indexOf("./sever2-home-core.js?v=116");
  const jsLegacy = sw.indexOf("./sever2-home-core.js?v=85");
  assert.ok(cssCurrent >= 0 && cssLegacy > cssCurrent);
  assert.ok(jsCurrent >= 0 && jsLegacy > jsCurrent);
  assert.match(sw, /v116 makes Home choose one next step first/);
});
