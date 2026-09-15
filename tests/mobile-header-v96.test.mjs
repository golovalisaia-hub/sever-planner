import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const css = fs.readFileSync(path.join(root, 'sever2-experience-v94.css'), 'utf8');
const experienceJs = fs.readFileSync(path.join(root, 'sever2-experience-v94.js'), 'utf8');
const aiCss = fs.readFileSync(path.join(root, 'sever-ai.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('mobile header docks AI beside a fixed-footprint sync status point', () => {
  assert.match(aiCss, /\.sever-ai-launch\{top:calc\(4px \+ env\(safe-area-inset-top\)\);right:max\(12px,env\(safe-area-inset-right\)\)/);
  assert.match(experienceJs, /function syncAiLauncherPlacement\(\)/);
  assert.match(experienceJs, /actions\.append\(ai\)/);
  assert.match(experienceJs, /ai\.dataset\.severHeaderDock = 'true'/);
  assert.match(experienceJs, /home\.insertBefore\(ai, aiLauncherHome\.nextSibling\)/);
  assert.match(css, /\.topbar \.top-actions > \.sever-ai-launch\[data-sever-header-dock="true"\][\s\S]*position:\s*static !important/);
  assert.match(css, /\.topbar \.top-actions\s*\{[\s\S]*flex:\s*0 1 auto/);
  assert.match(css, /\.sever-sync-indicator\s*\{[\s\S]*width:\s*14px[\s\S]*flex:\s*0 0 14px/);
  assert.match(css, /\.sever-sync-copy\s*\{[\s\S]*clip-path:\s*inset\(50%\)/);
  assert.match(css, /data-state="ok"[\s\S]*#35a968/);
  assert.match(css, /data-state="busy"[\s\S]*#d49a37/);
  assert.match(css, /data-state="offline"[\s\S]*#d85b5b/);
  assert.doesNotMatch(css, /max-width:\s*min\(148px, 39vw\)/);
  assert.doesNotMatch(css, /\.topbar \.top-actions\s*\{[\s\S]{0,160}padding-right:\s*60px/);
});

test('SEVER automatically selects winter, spring, summer and autumn', () => {
  assert.match(experienceJs, /const seasonIcons = \{[\s\S]*winter:[\s\S]*spring:[\s\S]*summer:[\s\S]*autumn:/);
  assert.doesNotMatch(experienceJs, /SEVER_SEASON_OVERRIDE/);
  assert.match(experienceJs, /function seasonForMonth\(month\)/);
  assert.match(experienceJs, /month === 11 \|\| month <= 1/);
  assert.match(experienceJs, /month <= 4/);
  assert.match(experienceJs, /month <= 7/);
  assert.match(experienceJs, /const season = seasonForMonth\(new Date\(\)\.getMonth\(\)\)/);
  assert.match(experienceJs, /dataset\.severSeason = season/);
  assert.match(experienceJs, /severSeasonSignature = 'v101'/);
  assert.match(experienceJs, /className = 'sever-season-mark'/);
  for (const season of ['winter', 'spring', 'summer', 'autumn']) {
    assert.match(css, new RegExp(`\\.sever-season-mark\\[data-season="${season}"\\]`));
  }
  assert.match(css, /\.mobile-wordmark \.sever-season-mark\s*\{[\s\S]*position:\s*absolute !important/);
  assert.match(css, /\.mobile-wordmark \.sever-season-mark\s*\{[\s\S]*max-width:\s*11px !important/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.sever-season-mark[\s\S]*animation:\s*none !important/);
});

test('installed PWA preserves v103 autumn polish, v102 desktop and v101 reliability', () => {
  assert.match(sw, /v103 refreshes the autumn wordmark animation/);
  assert.match(sw, /v102 simplifies desktop command\/create hierarchy/);
  assert.match(sw, /v101 refreshes mobile reliability assets/);
  assert.match(sw, /v100 refreshes Sever AI/);
  assert.match(sw, /v110\.2 repairs iOS direct-gesture Web Push subscription/);
  const release = sw.match(/const CACHE = 'sever-v(\d+)-[^']+'/);
  assert.ok(release && Number(release[1]) >= 103, 'current atomic cache must preserve the v103/v102/v101 release lineage');
  assert.ok(sw.includes("'./sever2-efficiency.css?v=102'"));
  assert.ok(sw.includes("'./sever2-experience-v94.css?v=101'"));
  assert.ok(sw.includes("'./sever2-experience-v94.js?v=101'"));
  assert.ok(sw.includes("'./sever2-interaction-polish.css?v=103'"));
  assert.ok(sw.includes("'./sever2-interaction-polish.js?v=109'"));
  assert.ok(sw.includes("'./sever2-reminder-bridge-v95.js?v=1102'"));
  assert.ok(sw.includes("'./js/sever-ai.js?v=100'"));
});