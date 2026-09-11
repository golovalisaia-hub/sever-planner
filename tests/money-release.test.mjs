import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('sever2-money.js');
const css = read('sever2-money.css');
const sync = read('js/sync-core.mjs');
const manifest = read('supabase/functions/sever-ai/manifest.ts');

test('Money v77 is syntax-valid and stores its data inside synced profile settings', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-money.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(source, /state\.profile\.money = normalizeMoney/);
  assert.match(source, /window\.SeverApp\.persist/);
  assert.match(source, /window\.SeverCloud\?\.capture/);
  assert.match(sync, /profile:obj\(state\.profile\)/);
  assert.doesNotMatch(source, /from\(['"](?:bank|transactions|debts|finance)/i);
  assert.doesNotMatch(source, /service_role|bank api|openbanking/i);
});

test('Money supports debt, savings, progress and optional calendar reminders without guessing interest', () => {
  assert.match(source, /type === 'goal' \? 'goal' : 'debt'/);
  assert.match(source, /monthlyBudget/);
  assert.match(source, /currentAmount/);
  assert.match(source, /Расчёт долга — без процентов/);
  assert.match(source, /Это только план: фактический платёж отмечается здесь отдельно/);
  assert.match(source, /calendarTaskIds/);
  assert.match(source, /parseQuick/);
  assert.match(source, /долг\|долж\|задолж/);
  assert.match(source, /накоп\|отлож\|собрат\|цель/);
});

test('Money has responsive touch-safe presentation and Sever AI can navigate to the page', () => {
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /\.money-list/);
  assert.match(css, /\.money-card-actions/);
  assert.match(manifest, /money:'Деньги: долги и накопления'/);
  assert.match(manifest, /page==='money'.*plan\.create/s);
});
