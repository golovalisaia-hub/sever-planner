import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('sever2-cloud-recovery.js');
const css = read('sever2-cloud-recovery.css');
const themeInit = read('js/theme-init.js');
const sw = read('sw.js');

test('cloud recovery v80 is syntax-valid, bounded and preserves the local outbox', () => {
  const checked = spawnSync(process.execPath, ['--check', path.join(root, 'sever2-cloud-recovery.js')]);
  assert.equal(checked.status, 0, checked.stderr.toString());
  assert.match(source, /function withTimeout\(/);
  assert.match(source, /AUTH_TIMEOUT_MS/);
  assert.match(source, /SESSION_TIMEOUT_MS/);
  assert.match(source, /SYNC_TIMEOUT_MS/);
  assert.match(source, /WATCHDOG_MS/);
  assert.match(source, /function resetCoordination/);
  assert.doesNotMatch(source, /localStorage\.removeItem|sessionStorage\.removeItem|indexedDB\.deleteDatabase/);
  assert.doesNotMatch(source, /sever-cloud-queue-v2/);
  assert.match(source, /cloud\.recoverNow = async function/);
  assert.match(source, /window\.SeverSupabase\.retry\(\)/);
});

test('successful authentication is not reported as a bad login when only initial sync stalls', () => {
  assert.match(source, /client\.auth\.signInWithPassword/);
  assert.match(source, /if \(reason\?\.code !== 'SESSION_TIMEOUT' && reason\?\.code !== 'SYNC_TIMEOUT'\) throw reason/);
  assert.match(source, /this\.lastErrorCode = 'SYNC_TIMEOUT'/);
  assert.match(source, /this\.scheduleRetry\?\.\(\)/);
  assert.match(source, /return result\.data/);
  assert.match(source, /invalid refresh token/);
});

test('account UI exposes sync health and a safe recovery action', () => {
  assert.match(source, /accountHealth/);
  assert.match(source, /Восстановить связь/);
  assert.match(source, /Изменения останутся в очереди/);
  assert.match(source, /document\.documentElement\.dataset\.severCloudRecovery = 'ready'/);
  assert.match(css, /#accountDialog \.account-health/);
  assert.match(css, /#accountDialog #accountRetry:not\(\.hidden\)/);
});

test('cloud recovery v80 remains in the atomic v82 reminder PWA release', () => {
  const interaction = themeInit.indexOf('sever2-interaction-polish-script');
  const recovery = themeInit.indexOf('sever2-cloud-recovery-script');
  assert.ok(interaction >= 0 && recovery > interaction);
  assert.match(themeInit, /sever2-cloud-recovery\.css\?v=80/);
  assert.match(themeInit, /sever2-cloud-recovery\.js\?v=80/);
  assert.match(themeInit, /data-\$\{marker\}.*v80/s);
  assert.match(sw, /const CACHE = 'sever-v82-reminders-desktop-v5'/);
  for (const asset of [
    './sever2-cloud-recovery.css?v=80',
    './sever2-cloud-recovery.js?v=80',
    './js/theme-init.js?v=81',
    './sever2-reminders.css?v=82',
    './sever2-task-reminders.js?v=82'
  ]) assert.ok(sw.includes(`'${asset}'`), `missing ${asset}`);
});