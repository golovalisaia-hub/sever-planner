import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const css = fs.readFileSync(path.join(root, 'sever2-experience-v94.css'), 'utf8');
const experienceJs = fs.readFileSync(path.join(root, 'sever2-experience-v94.js'), 'utf8');
const aiCss = fs.readFileSync(path.join(root, 'sever-ai.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('mobile header reserves a dedicated lane for the fixed AI launcher', () => {
  assert.match(aiCss, /\.sever-ai-launch\{top:calc\(4px \+ env\(safe-area-inset-top\)\);right:max\(12px,env\(safe-area-inset-right\)\)/);
  assert.match(css, /\.topbar \.top-actions\s*\{[\s\S]*padding-right:\s*60px/);
  assert.match(css, /\.sever-sync-indicator\s*\{[\s\S]*max-width:\s*min\(148px, 39vw\)/);
});

test('SEVER wordmark signature follows all four seasons and stays motion-safe', () => {
  assert.match(experienceJs, /const seasonIcons = \{[\s\S]*winter:[\s\S]*spring:[\s\S]*summer:[\s\S]*autumn:/);
  assert.match(experienceJs, /function seasonForMonth\(month\)/);
  assert.match(experienceJs, /month === 11 \|\| month <= 1/);
  assert.match(experienceJs, /month <= 4/);
  assert.match(experienceJs, /month <= 7/);
  assert.match(experienceJs, /dataset\.severSeason = season/);
  assert.match(experienceJs, /className = 'sever-season-mark'/);
  for (const season of ['winter', 'spring', 'summer', 'autumn']) {
    assert.match(css, new RegExp(`\\.sever-season-mark\\[data-season="${season}"\\]`));
  }
  assert.match(css, /\.mobile-wordmark \.sever-season-mark\s*\{[\s\S]*position:\s*absolute/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.sever-season-mark[\s\S]*animation:\s*none !important/);
});

test('installed PWA refreshes the experience layer without changing the guarded atomic cache contract', () => {
  assert.match(sw, /v96 refreshes the existing atomic cache/);
  assert.match(sw, /const CACHE = 'sever-v94-experience-release-v1'/);
  assert.ok(sw.includes("'./sever2-experience-v94.css?v=94'"));
  assert.ok(sw.includes("'./sever2-experience-v94.js?v=94'"));
});
