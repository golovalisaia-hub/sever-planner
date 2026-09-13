import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const css = fs.readFileSync(path.join(root, 'sever2-experience-v94.css'), 'utf8');
const aiCss = fs.readFileSync(path.join(root, 'sever-ai.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('mobile header reserves a dedicated lane for the fixed AI launcher', () => {
  assert.match(aiCss, /\.sever-ai-launch\{top:calc\(4px \+ env\(safe-area-inset-top\)\);right:max\(12px,env\(safe-area-inset-right\)\)/);
  assert.match(css, /\.topbar \.top-actions\s*\{[\s\S]*padding-right:\s*60px/);
  assert.match(css, /\.sever-sync-indicator\s*\{[\s\S]*max-width:\s*min\(148px, 39vw\)/);
});

test('SEVER wordmark snow is minimal, decorative and motion-safe', () => {
  assert.match(css, /\.mobile-wordmark::after\s*\{[\s\S]*content:\s*"❄"/);
  assert.match(css, /animation:\s*sever-wordmark-snow 5\.8s ease-in-out infinite/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.mobile-wordmark::after[\s\S]*animation:\s*none !important/);
});

test('installed PWA refreshes the header stylesheet without changing the guarded atomic cache contract', () => {
  assert.match(sw, /v96 refreshes the existing atomic cache/);
  assert.match(sw, /const CACHE = 'sever-v94-experience-release-v1'/);
  assert.ok(sw.includes("'./sever2-experience-v94.css?v=94'"));
});
