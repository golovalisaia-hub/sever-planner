import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const js=fs.readFileSync(new URL('../sever2-finance-v111.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../sever2-finance-v111.css',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const manifest=fs.readFileSync(new URL('../supabase/functions/sever-ai/manifest.ts',import.meta.url),'utf8');

test('Finance v111 parses and loads only after the planner startup path', () => {
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/data-sever-finance-v111/);
  assert.match(js,/severFinance = 'v111'/);
  assert.match(js,/scheduleBoot/);
});

test('Finance v111 is a real finance center, not a label-only Money rename', () => {
  assert.match(js,/financeTabs/);
  assert.match(js,/overview/);
  assert.match(js,/budget/);
  assert.match(js,/transactions/);
  assert.match(js,/plans/);
  assert.match(js,/recurring/);
  assert.match(js,/categoryBudgets/);
  assert.match(js,/transactions/);
  assert.match(js,/Разобрать месяц/);
  assert.match(js,/Проверить бюджет/);
  assert.match(js,/Помочь с целью/);
});

test('Finance data stays inside synced SEVER profile settings and never creates a shadow localStorage store', () => {
  assert.match(js,/profile\.finance/);
  assert.doesNotMatch(js,/localStorage\.setItem\([^)]*finance/i);
  assert.doesNotMatch(js,/sessionStorage\.setItem\([^)]*finance/i);
});

test('Finance AI is user-triggered, bounded to the finance summary, and avoids risky financial suggestions', () => {
  assert.match(js,/SEVER AI/);
  assert.match(js,/не предлагай кредиты/i);
  assert.match(js,/не предлагай инвестиционные сделки/i);
  assert.match(js,/не предлагай рискованные способы заработка/i);
  assert.doesNotMatch(js,/setInterval\([^)]*AI/i);
});

test('Finance layout remains touch-safe and responsive down to narrow phones', () => {
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /@media\(max-width:360px\)/);
  assert.match(css, /min-height:42px/);
  assert.match(css, /finance-transaction-row/);
  assert.match(css, /finance-budget-row/);
  assert.match(css, /finance-ai/);
});

test('Finance v111 remains part of the guarded v112 offline release and AI knows the renamed page', () => {
  assert.match(sw, /const CACHE = 'sever-v112-email-otp-release-v1'/);
  for (const asset of ['./sever2-finance-v111.css?v=111','./sever2-finance-v111.js?v=111','./sever2-notes-org-repair-v95.js?v=111']) {
    assert.ok(sw.includes(`'${asset}'`), `missing ${asset}`);
  }
  assert.ok(sw.includes("'/sever2-finance-v111.css'"));
  assert.ok(sw.includes("'/sever2-finance-v111.js'"));
  assert.match(manifest, /money:'Финансы: бюджет, операции, регулярные платежи, долги и накопления'/);
  assert.match(manifest, /финанс\|бюджет\|расход\|доход/);
});