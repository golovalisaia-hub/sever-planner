import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('mobile consistency v76 remains loaded inside the v80 cloud recovery release and seeds only a truly fresh planner with Calm', async () => {
  const source = await read('js/theme-init.js');
  assert.match(source, /sever2-mobile-consistency\.css\?v=76/);
  assert.match(source, /sever2-notes-polish\.css\?v=79/);
  assert.match(source, /sever2-notes-polish\.js\?v=79/);
  assert.match(source, /sever2-money\.css\?v=77/);
  assert.match(source, /sever2-money\.js\?v=77/);
  assert.match(source, /sever2-interaction-polish\.css\?v=78/);
  assert.match(source, /sever2-interaction-polish\.js\?v=78/);
  assert.match(source, /sever2-cloud-recovery\.css\?v=80/);
  assert.match(source, /sever2-cloud-recovery\.js\?v=80/);
  assert.match(source, /data-\$\{marker\}.*v80/s);
  assert.match(source, /const allowed = new Set\(\['light', 'motion', 'black'\]\)/);
  assert.match(source, /function seedFreshAnonymousState\(\)/);
  assert.match(source, /ANONYMOUS_STATE_KEY = 'sever-anonymous-state-v1'/);
  assert.match(source, /LEGACY_STATE_KEY = 'sever-data-v2'/);
  assert.match(source, /LEGACY_MIGRATION_KEY = 'sever-legacy-migration-v1'/);
  assert.match(source, /if \(localStorage\.getItem\(ANONYMOUS_STATE_KEY\)\) return/);
  assert.match(source, /if \(legacyState && !legacyMigrated\) return/);
  assert.match(source, /const theme = persisted \? normalize\(persisted\) : 'light'/);
  assert.match(source, /appearance: \{ theme, animations: 'auto', reduceEffects: false \}/);
  assert.match(source, /seedFreshAnonymousState\(\);\s*retireLegacyHomeLayer\(\)/s);
  assert.doesNotMatch(source, /settleFirstThemeForFreshProfile/);
});

test('mobile consistency only changes presentation and does not create a second planner data model', async () => {
  const source = await read('sever2-mobile-consistency.css');
  assert.match(source, /--sever-mobile-nav-clearance/);
  assert.match(source, /#timerView \.timer-ring/);
  assert.match(source, /\.bottom-nav button/);
  assert.doesNotMatch(source, /localStorage|indexedDB|Supabase|fetch\(/i);
});
