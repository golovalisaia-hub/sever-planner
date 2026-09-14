import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('sever2-onboarding-v110.js');
const css = read('sever2-onboarding-v110.css');
const coreCss = read('onboarding.css');
const repair = read('sever2-notes-org-repair-v95.js');
const sw = read('sw.js');

test('v110 onboarding parses and loads through the stable late UI bootstrap', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-onboarding-v110.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(repair, /function installOnboardingV110Layer\(\)/);
  assert.match(repair, /function scheduleOnboardingV110\(\)/);
  assert.match(repair, /window\.addEventListener\('load',[\s\S]*installOnboardingV110Layer/);
  assert.match(repair, /script\.async = true/);
  assert.doesNotMatch(repair, /\n\s*installOnboardingV110Layer\(\);\s*\n/);
  assert.match(repair, /sever2-onboarding-v110\.css\?v=110/);
  assert.match(repair, /sever2-onboarding-v110\.js\?v=110/);
  assert.match(js, /dataset\.severOnboarding = 'v110'/);
});

test('v110 teaches the smallest useful mental model instead of every feature', () => {
  assert.match(js, /Чтобы начать, достаточно одного дела на сегодня/);
  assert.match(js, /Главная — это сегодняшний день/);
  assert.match(js, /Добавь одно дело/);
  assert.match(js, /включи фокус/);
  assert.match(js, /Всё под рукой/);
  assert.match(js, /Остальное — по мере надобности/);
  assert.match(js, /Календарь хранит планы и историю/);
  assert.match(js, /Заметки — мысли и чек-листы/);
  assert.match(js, /Деньги помогают держать финансовые планы рядом/);
  assert.match(js, /всегда можно открыть снова в Настройках/);
});

test('v110 finishes with a real first action and keeps contextual empty-state help', () => {
  assert.match(js, /Добавить первую задачу/);
  assert.match(js, /function openFirstTask\(\)/);
  assert.match(js, /typeof openTask === 'function'/);
  assert.match(js, /function focusTaskTitle\(\)/);
  assert.match(js, /input\.focus/);
  assert.match(js, /После создания открой задачу/);
  assert.match(js, /Быстрое знакомство/);
  assert.match(js, /state\(\)\?\.onboarded \? 'Закрыть' : 'Пропустить'/);
});

test('v110 DOM observers are idempotent and cannot self-trigger forever', () => {
  assert.match(js, /if \(copy && copy\.textContent !== EMPTY_TODAY_COPY\) copy\.textContent = EMPTY_TODAY_COPY/);
  assert.match(js, /if \(button && button\.textContent !== EMPTY_TODAY_ACTION\) button\.textContent = EMPTY_TODAY_ACTION/);
  assert.match(js, /todayObserver\.observe\(tasks, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(js, /if \(copy\) copy\.textContent = 'Начни с одного дела/);
});

test('v110 cloud fallback is bounded to local mode and never bypasses configured account hydration', () => {
  assert.match(js, /cloud\.configured !== false/);
  assert.match(js, /window\.SeverCloudReady/);
  assert.match(js, /1200/);
  assert.match(js, /state\(\)\?\.onboarded/);
});

test('v110 historical day refresh waits beyond task mutation scheduling', () => {
  assert.match(js, /function installHistoricalDayRepair\(\)/);
  assert.match(js, /#dayTaskList \.check, #toast button/);
  assert.match(js, /function scheduleHistoricalDayRefresh\(date\)/);
  assert.match(js, /setTimeout\(\(\) => \{[\s\S]*requestAnimationFrame\(\(\) => refreshOpenHistoricalDay\(date\)\)/);
  assert.match(js, /dialog\.close\(\)/);
  assert.match(js, /cell\.click\(\)/);
});

test('v110 onboarding stays phone-safe, readable before late polish, and part of the atomic offline release', () => {
  assert.match(css, /@media\(max-width:350px\)/);
  assert.match(css, /max-width:64vw/);
  assert.match(css, /--sever110-guide-text:#f7f4ef/);
  assert.match(css, /--sever110-guide-muted:rgba\(247,244,239,\.82\)/);
  assert.match(css, /guide-copy h2\{color:var\(--sever110-guide-text\)/);
  assert.match(coreCss, /dialog\.guide-dialog\{[^}]*color:#f7f4ef/);
  assert.match(coreCss, /--guide-text:#f7f4ef/);
  assert.match(coreCss, /guide-copy h2\{[^}]*color:var\(--guide-text\)/);
  assert.match(coreCss, /guide-copy p\{[^}]*color:var\(--guide-muted\)/);
  assert.match(sw, /const CACHE = 'sever-v110-first-run-onboarding-release-v1'/);
  for (const asset of [
    './sever2-onboarding-v110.css?v=110',
    './sever2-onboarding-v110.js?v=110',
    './sever2-notes-org-repair-v95.js?v=110'
  ]) assert.ok(sw.includes(`'${asset}'`), `missing ${asset}`);
  assert.ok(sw.includes("'/sever2-onboarding-v110.css'"));
  assert.ok(sw.includes("'/sever2-onboarding-v110.js'"));
});