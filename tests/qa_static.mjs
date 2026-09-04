import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const app = read('app.js');
const notes = read('notes-pro.js');
const css = `${read('style.css')}\n${read('qa.css')}`;
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.webmanifest'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const syntax = async file => { const { spawnSync } = await import('node:child_process'); const result = spawnSync(process.execPath, ['--check', path.join(root, file)]); assert.equal(result.status, 0, result.stderr.toString()); };

test('Notes module has no syntax errors', () => syntax('notes-pro.js'));
test('Planner JavaScript has no syntax errors', () => syntax('app.js'));
test('Cloud runtime modules have no syntax errors', async () => { await syntax('js/supabase-client.js'); await syntax('js/cloud-runtime.js'); await syntax('js/sync-core.mjs'); });
test('PWA cache contains every required local asset', () => { const assets = [...sw.matchAll(/'\.\/([^']+)'/g)].map(match => match[1].split('?')[0]); for (const asset of assets.filter(Boolean)) assert.ok(fs.existsSync(path.join(root, asset)), `Missing cached asset: ${asset}`); for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, icon.src)), `Missing manifest icon: ${icon.src}`); });
test('Asset versions are aligned to v26', () => { for (const asset of ['style.css', 'qa.css', 'app.js', 'notes-pro.js']) { assert.match(html, new RegExp(`${asset.replace('.', '\\.')}\\?v=26`)); assert.match(sw, new RegExp(`${asset.replace('.', '\\.')}\\?v=26`)); } assert.match(sw, /sever-v26/); });
test('Desktop shell and mobile navigation are both reachable', () => { assert.match(html, /class="desktop-sidebar"/); assert.match(html, /class="desktop-rail"/); assert.equal((html.match(/class="nav-icon"/g) || []).length, 6); assert.equal((html.match(/class="nav-label"/g) || []).length, 6); assert.match(html, /data-view="habits"/); assert.match(css, /@media\(min-width:901px\)/); assert.match(css, /@media\(max-width:650px\)\{\.bottom-nav\{grid-template-columns:repeat\(6/); });
test('A new user starts without personal tasks', () => { assert.match(app, /function freshState\(\)\{return\{version:9[^\n]+tasks:\[\]/); assert.doesNotMatch(app, /function freshState\(\)[^\n]+(?:Пайтон|Python|ПДД)/i); });
test('Storage has local and IndexedDB copies plus JSON backup controls', () => { assert.match(app, /localStorage\.setItem\(storageKey/); assert.match(app, /indexedDB\.open/); assert.match(html, /id="exportBtn"/); assert.match(html, /id="importInput"/); });
test('Cloud sync has a safe static UI and public-only configuration', () => { assert.ok(fs.existsSync(path.join(root, 'supabase-config.js'))); assert.ok(fs.existsSync(path.join(root, 'js', 'cloud-runtime.js'))); assert.ok(fs.existsSync(path.join(root, 'supabase', 'migrations', '001_initial_cloud_sync.sql'))); assert.match(html, /id="accountDialog"/); assert.match(html, /id="migrationDialog"/); assert.match(html, /js\/cloud-runtime\.js\?v=26/); assert.match(read('supabase-config.js'), /anonKey:\s*'sb_publishable_/); assert.doesNotMatch(read('supabase-config.js'), /service_role[_\\s]*key\\s*:/i); });
test('Cloud status updates both profile surfaces without throwing', () => { assert.match(app, /settingsLabel=\$\('#cloudStatusSettings'\)/); assert.match(app, /if\(settingsLabel\)settingsLabel\.textContent=/); });
test('Protected notes use PBKDF2 and authenticated AES-GCM encryption', () => { assert.match(notes, /NOTE_CRYPTO_ITERATIONS = 600000/); assert.match(notes, /name: 'PBKDF2'/); assert.match(notes, /hash: 'SHA-256'/); assert.match(notes, /name: 'AES-GCM'/); assert.match(notes, /crypto\.getRandomValues\(new Uint8Array\(16\)\)/); assert.doesNotMatch(notes, /password\s*:/i); });
test('Tasks support reversible action-sheet flows and the calendar opens a day plan', () => { for (const id of ['taskActionComplete', 'taskActionMove', 'taskActionDelete', 'dayDialog']) assert.match(html, new RegExp(`id="${id}"`)); for (const fn of ['completeTask', 'moveTaskToTomorrow', 'openDay']) assert.match(app, new RegExp(`function ${fn}`)); assert.match(app, /button\.textContent='Отменить'/); });
test('Linked tasks always open the visible timer tab and complete back on Today', () => { assert.match(app, /switchView\('timer'\);startTimer\(\)/); assert.match(app, /completeTask\(task,\{returnToToday:true/); assert.match(app, /setTimeout\(\(\)=>switchView\('today'\),450\)/); });
test('Focus sessions are primary cloud data and timer does not write every tick', () => { assert.match(app, /focusSessions:\[\]/); assert.match(app, /state\.focusSessions\.push/); assert.match(app, /if\(now-lastFocusPersistAt>=15000\)/); });
test('Progress is calendar-based and keeps Undo interactive', () => { assert.match(html, /id="progressMonthTitle"/); assert.match(app, /task\.completedAt=Date\.now\(\)/); assert.match(app, /task\.completedAt=null/); assert.match(css, /\.heat\.future/); });
test('Large realistic state stays comfortably below localStorage quota', () => { const tasks = Array.from({ length: 1500 }, (_, index) => ({ id: `task-${index}`, title: `Задача ${index}`, date: '2026-09-03', duration: index % 2 ? 30 : null, category: 'Личное', completed: index % 3 === 0, priority: false })); const notes = Array.from({ length: 500 }, (_, index) => ({ id: `note-${index}`, title: `Заметка ${index}`, body: 'Подробный текст заметки. '.repeat(30), kind: 'checklist', items: Array.from({ length: 20 }, (_, item) => ({ id: `${index}-${item}`, text: `Пункт ${item}`, done: item % 2 === 0 })) })); const started = performance.now(); const serialized = JSON.stringify({ version: 9, tasks, notes, habits: [], checks: {}, focusSessions: [] }); const parsed = JSON.parse(serialized); assert.equal(parsed.tasks.length, 1500); assert.ok(Buffer.byteLength(serialized) < 4_000_000); assert.ok(performance.now() - started < 1000); });

let passed = 0;
for (const { name, fn } of tests) { try { await fn(); passed += 1; console.log(`PASS  ${name}`); } catch (error) { console.error(`FAIL  ${name}`); console.error(error.message); process.exitCode = 1; } }
console.log(`\n${passed}/${tests.length} checks passed`);
