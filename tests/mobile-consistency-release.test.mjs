import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('mobile consistency v76 is loaded after the existing product layers', async () => {
  const source = await read('js/theme-init.js');
  assert.match(source, /sever2-mobile-consistency\.css\?v=76/);
  assert.match(source, /data-\$\{marker\}.*v76/s);
  assert.match(source, /const allowed = new Set\(\['light', 'motion', 'black'\]\)/);
  assert.match(source, /function pinFirstThemeForFreshProfile\(\)/);
  assert.match(source, /state\.onboarded !== false/);
  assert.match(source, /theme: 'light'/);
});

test('mobile consistency only changes presentation and does not create a second planner data model', async () => {
  const source = await read('sever2-mobile-consistency.css');
  assert.match(source, /--sever-mobile-nav-clearance/);
  assert.match(source, /#timerView \.timer-ring/);
  assert.match(source, /\.bottom-nav button/);
  assert.doesNotMatch(source, /localStorage|indexedDB|Supabase|fetch\(/i);
});
