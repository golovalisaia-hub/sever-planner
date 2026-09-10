import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));
const html = read('index.html');
const app = read('app.js');
const notes = read('notes-pro.js');
const mobileUi = read('mobile-ui.js');
const themeInit = read('js/theme-init.js');
const syncCore = read('js/sync-core.mjs');
const cloud = read('js/cloud-runtime.js');
const cryptoCore = read('js/protected-notes-crypto.js');
const securityCore = read('js/security-core.js');
const homeFocus = read('sever2-home-focus.js');
const taskFlow = read('sever2-task-flow.js');
const taskFlowCss = read('sever2-task-flow.css');
const vault = read('sever-notes-vault.js');
const vaultLoader = read('sever-notes-vault-loader.js');
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.webmanifest'));
const baseCss = [read('style.css'), read('qa.css'), read('responsive.css'), read('design-system.css'), read('sever-v41.css'), read('sever2-ui.css'), read('sever2-qa.css'), read('sever2-home-focus.css'), taskFlowCss].join('\n');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const syntax = file => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding:'utf8' });
  assert.equal(result.status, 0, result.stderr || `${file} syntax error`);
};

test('critical JavaScript and module files parse', () => {
  for (const file of ['app.js','notes-pro.js','mobile-ui.js','js/theme-init.js','js/supabase-client.js','js/cloud-runtime.js','js/sync-core.mjs','sever2-home-focus.js','sever-notes-vault-loader.js','sever-notes-vault.js','sever2-task-flow.js']) syntax(file);
});

test('PWA release cache contains every declared local asset', () => {
  const assets = [...sw.matchAll(/'\.\/([^']+)'/g)].map(match => match[1].split('?')[0]).filter(Boolean);
  for (const asset of assets) assert.ok(exists(asset), `Missing cached asset: ${asset}`);
  for (const icon of manifest.icons || []) assert.ok(exists(icon.src), `Missing icon: ${icon.src}`);
});

test('v69 atomic release ships Home, encrypted Notes Vault and adaptive task flow', () => {
  assert.match(sw, /const CACHE = 'sever-v69-task-modes'/);
  for (const token of [
    'sever2-home-focus.css?v=72','sever2-home-focus.js?v=72','sever-notes-vault-loader.js?v=73','sever-notes-vault.js?v=73',
    'sever2-task-flow.css?v=73','sever2-task-flow.js?v=73','js/theme-init.js?v=73','js/protected-notes-crypto.js?v=72','js/security-core.js?v=72'
  ]) assert.ok(sw.includes(token), `release missing ${token}`);
  assert.match(themeInit, /sever-notes-vault-loader\.js\?v=73/);
  assert.match(themeInit, /sever2-task-flow\.js\?v=73/);
  assert.doesNotMatch(themeInit, /sever-notes-vault\.js\?v=72/);
});

test('Notes Vault bootstrap waits for crypto, app and notes before loading runtime', () => {
  assert.match(vaultLoader, /SeverProtectedNotesCrypto/);
  assert.match(vaultLoader, /SeverSecurityCore/);
  assert.match(vaultLoader, /SeverApp/);
  assert.match(vaultLoader, /SeverNotes/);
  assert.match(vaultLoader, /sever-notes-vault\.js\?v=73/);
});

test('Notes Vault uses password-derived authenticated encryption without persisting plaintext', () => {
  assert.match(cryptoCore, /AES-GCM/);
  assert.match(cryptoCore, /PBKDF2/);
  assert.match(cryptoCore, /SHA-256/);
  assert.match(cryptoCore, /600000/);
  assert.match(vault, /hardenPlaintextNotes/);
  assert.match(vault, /title:''/);
  assert.match(vault, /body:''/);
  assert.match(vault, /kind:'protected'/);
  assert.doesNotMatch(vault, /password\s*:/i);
});

test('persistent and cloud note invariants never send protected plaintext', () => {
  assert.match(securityCore, /assertProtectedNote/);
  assert.match(securityCore, /note\.title !== ''/);
  assert.match(securityCore, /note\.body !== ''/);
  assert.match(syncCore, /protectedNoteInvariant/);
  assert.match(syncCore, /title:note\.protected\?'':/);
  assert.match(syncCore, /body:note\.protected\?'':/);
  assert.match(cloud, /title: record\.protected \? ''/);
  assert.match(cloud, /body: record\.protected \? ''/);
  assert.match(cloud, /items: record\.protected \? \[\]/);
});

test('Notes Vault locks on account/background signals and supports explicit rekey', () => {
  assert.match(vault, /sever:account-scope/);
  assert.match(vault, /sever:lock-protected-notes/);
  assert.match(vault, /visibilitychange/);
  assert.match(vault, /shouldAutoLock/);
  assert.match(vault, /rekeyVault/);
});

test('task modes reuse existing synchronized fields instead of inventing a new schema column', () => {
  assert.match(taskFlow, /if \(task\.time\) return MODES\.SCHEDULED/);
  assert.match(taskFlow, /if \(Number\(task\.duration\) > 0\) return MODES\.FOCUS/);
  assert.match(taskFlow, /task\.category === 'Учёба'/);
  assert.match(taskFlow, /task\.category === 'Дела'/);
  assert.doesNotMatch(syncCore, /executionMode|execution_mode/);
  assert.doesNotMatch(cloud, /executionMode|execution_mode/);
});

test('Study, errands and custom tasks have distinct user-facing execution controls', () => {
  assert.match(taskFlow, /data-task-mode=\"flexible\"/);
  assert.match(taskFlow, /data-task-mode=\"focus\"/);
  assert.match(taskFlow, /data-task-mode=\"scheduled\"/);
  assert.match(taskFlow, /option\.value = option\.textContent = 'Дела'/);
  assert.match(taskFlow, /event\.target\.value === 'Учёба'/);
  assert.match(taskFlow, /event\.target\.value === 'Дела'/);
  assert.match(taskFlow, /duration\.value = '30'/);
  assert.match(taskFlow, /time\.required = mode === MODES\.SCHEDULED/);
});

test('quick create supports simple, focus and scheduled modes with mobile-sized controls', () => {
  assert.match(taskFlow, /severQuickModeField/);
  assert.match(taskFlow, /severQuickFocusMinutes/);
  assert.match(taskFlow, /severQuickTime/);
  assert.match(taskFlowCss, /min-height:44px/);
  assert.match(taskFlowCss, /@media\(max-width:900px\)/);
});

test('Home keeps one focused task surface and no ADMIN greeting dependency', () => {
  assert.match(homeFocus, /sever2HomeFocus/);
  assert.doesNotMatch(homeFocus, /ADMIN/);
  assert.match(homeFocus, /sever2HomeInboxButton/);
  assert.match(homeFocus, /sever2HomeFocusButton/);
  assert.match(homeFocus, /sever2HomeQuickNoteButton/);
  assert.doesNotMatch(homeFocus, /sever2HomeCreate/);
});

test('desktop and mobile keep accessible primary create targets', () => {
  assert.match(html, /id="globalAddBtn"/);
  assert.match(html, /id="mobileCreateBtn"/);
  assert.match(taskFlowCss, /\.top-actions #globalAddBtn[\s\S]*?width:44px!important/);
  assert.match(baseCss, /\.bottom-nav/);
});

test('new users start clean and no personal demo task is seeded', () => {
  assert.match(app, /function freshState\(\)\{return\{version:11[^\n]+tasks:\[\]/);
  assert.doesNotMatch(app, /function freshState\(\)[^\n]+(?:Пайтон|Python|ПДД)/i);
});

test('storage keeps localStorage and IndexedDB copies', () => {
  assert.match(app, /localStorage\.setItem\(storageKey/);
  assert.match(app, /indexedDB\.open/);
  assert.match(app, /writeStorageBackup/);
  assert.match(html, /id="exportBtn"/);
  assert.match(html, /id="importInput"/);
});

test('cloud account scope hydrates before writes and anonymous import is explicit', () => {
  assert.match(cloud, /if \(!this\.user \|\| !this\.hydrated\) return/);
  assert.match(cloud, /switchStorageScope\(null, this\.app\.freshState\(\)\)/);
  assert.match(cloud, /getAnonymousImportCandidate/);
  assert.match(cloud, /acceptMigration/);
  assert.match(cloud, /keepLocalOnly/);
});

test('public cloud config contains no privileged secret', () => {
  const config = read('supabase-config.js');
  assert.doesNotMatch(config, /service[_-]?role/i);
  assert.doesNotMatch(config, /sb_secret_/i);
});

test('three product themes remain visual skins over one app', () => {
  assert.match(themeInit, /new Set\(\['light', 'motion', 'black'\]\)/);
  for (const label of ['Calm Balance','Cozy Mood','Focus Peak']) assert.match(themeInit, new RegExp(label));
  assert.match(themeInit, /aurora: 'light'/);
  assert.match(themeInit, /north: 'light'/);
});

test('retired mountain and Aurora artwork is not in active offline assets', () => {
  assert.doesNotMatch(sw, /\.\/aurora\.webp/);
  assert.doesNotMatch(sw, /assets\/sever\/ice-dawn\.svg/);
  assert.doesNotMatch(sw, /assets\/sever\/mountain-night\.svg/);
  assert.match(themeInit, /retireLegacyHomeLayer/);
});

test('mobile shell has exactly five bottom navigation labels', () => {
  assert.equal((html.match(/class="nav-label"/g) || []).length, 5);
  assert.equal((html.match(/class="nav-icon"/g) || []).length, 5);
  assert.match(html, /data-mobile-more="true"/);
  assert.match(mobileUi, /function updateHeader/);
});

test('timer completion remains linked to primary focus-session data', () => {
  assert.match(app, /focusSessions:\[\]/);
  assert.match(app, /state\.focusSessions\.push/);
  assert.match(app, /startLinkedTask/);
  assert.match(app, /completeTimerTask/);
});

test('Undo and conflict protection remain wired for planner entities', () => {
  assert.match(app, /function performUndo/);
  assert.match(app, /task-delete/);
  assert.match(app, /note-delete/);
  assert.match(app, /folder-delete/);
  assert.match(read('js/ui-state.js'), /markRemoteConflicts/);
});

test('calendar selection retains visible focus and unclipped rounded cells', () => {
  const css = read('sever-v41.css') + '\n' + read('sever2-ui.css');
  assert.match(css, /\.day\.today/);
  assert.match(css, /overflow:\s*visible/);
  assert.match(css, /border-radius/);
});

test('large realistic state remains below common localStorage limits', () => {
  const tasks = Array.from({ length:1500 }, (_, i) => ({ id:`t${i}`, title:`Задача ${i}`, date:'2026-09-11', duration:i%2?30:null, category:'Личное', completed:i%3===0 }));
  const notesData = Array.from({ length:500 }, (_, i) => ({ id:`n${i}`, title:`Заметка ${i}`, body:'Текст '.repeat(120), items:[] }));
  const started = performance.now();
  const serialized = JSON.stringify({ version:11, tasks, notes:notesData, habits:[], focusSessions:[] });
  assert.ok(Buffer.byteLength(serialized) < 4_000_000);
  assert.ok(performance.now() - started < 1000);
});

let passed = 0;
for (const { name, fn } of tests) {
  try { await fn(); passed += 1; console.log(`PASS  ${name}`); }
  catch (error) { console.error(`FAIL  ${name}`); console.error(error.stack || error.message); process.exitCode = 1; }
}
console.log(`\n${passed}/${tests.length} checks passed`);
