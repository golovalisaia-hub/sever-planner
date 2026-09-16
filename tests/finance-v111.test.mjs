import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('sever2-finance-v111.js');
const css = read('sever2-finance-v111.css');
const loader = read('sever2-notes-org-repair-v95.js');
const sw = read('sw.js');
const manifest = read('supabase/functions/sever-ai/manifest.ts');

test('Finance v111 parses and loads only after the planner startup path', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-finance-v111.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(loader, /function installFinanceV111Layer\(\)/);
  assert.match(loader, /sever2-finance-v111\.css\?v=111/);
  assert.match(loader, /sever2-finance-v111\.js\?v=111/);
  assert.match(loader, /window\.addEventListener\('load',[\s\S]*installLateExperienceLayers/);
  assert.match(loader, /script\.async = true/);
});

test('Finance v111 is a real finance center, not a label-only Money rename', () => {
  for (const feature of [
    'ФИНАНСОВЫЙ ЦЕНТР', 'Финансы', 'Бюджет', 'Операции', 'Регулярные платежи',
    'Финансовый помощник', 'Разобрать месяц', 'Проверить бюджет', 'Помочь с целью'
  ]) assert.ok(js.includes(feature), `missing ${feature}`);
  assert.match(js, /transactions:/);
  assert.match(js, /budgets,/);
  assert.match(js, /recurrings:/);
  assert.match(js, /data-finance-recurring-pay/);
  assert.match(js, /financeState\(\)\.transactions\.push/);
  assert.match(js, /legacyPlanMonthly\(\)/);
});

test('Finance data stays inside synced SEVER profile settings and never creates a shadow localStorage store', () => {
  assert.match(js, /state\.profile\.finance = normalizeFinance/);
  assert.match(js, /await window\.SeverApp\?\.persist\?\.\(\)/);
  assert.match(js, /window\.SeverCloud\?\.capture\?\.\(\)/);
  assert.doesNotMatch(js, /localStorage\.(?:getItem|setItem)\(/);
  assert.doesNotMatch(js, /sessionStorage\.(?:getItem|setItem)\(/);
});

test('Finance AI is user-triggered, bounded to the finance summary, and avoids risky financial suggestions', () => {
  assert.match(js, /data-finance-ai="month"/);
  assert.match(js, /Сводка отправляется Sever AI только после твоего нажатия/);
  assert.match(js, /function financeSummary\(\)/);
  assert.match(js, /function askAI\(kind\)/);
  assert.match(js, /window\.SeverAI\?\.open\?\.\(\)/);
  assert.match(js, /Не предлагай кредиты, инвестиционные сделки или рискованные способы заработка/);
  assert.match(js, /window\.SeverCloud\?\.user && window\.SeverCloud\?\.hydrated/);
});

test('Finance layout remains touch-safe and responsive down to narrow phones', () => {
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /@media\(max-width:360px\)/);
  assert.match(css, /min-height:42px/);
  assert.match(css, /finance-transaction-row/);
  assert.match(css, /finance-budget-row/);
  assert.match(css, /finance-ai/);
});

test('Finance v111 is part of the guarded offline release and AI knows the renamed page', () => {
  assert.match(sw, /const CACHE = 'sever-v126-push-ui-v1'/);
  for (const asset of ['./sever2-finance-v111.css?v=111','./sever2-finance-v111.js?v=111','./sever2-notes-org-repair-v95.js?v=111']) {
    assert.ok(sw.includes(`'${asset}'`), `missing ${asset}`);
  }
  assert.ok(sw.includes("'/sever2-finance-v111.css'"));
  assert.ok(sw.includes("'/sever2-finance-v111.js'"));
  assert.match(manifest, /money:'Финансы: бюджет, операции, регулярные платежи, долги и накопления'/);
  assert.match(manifest, /финанс\|бюджет\|расход\|доход/);
});
