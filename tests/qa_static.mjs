import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const app = read('app.js');
const css = `${read('style.css')}\n${read('qa.css')}`;
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.webmanifest'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('JavaScript has no syntax errors', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['--check', path.join(root, 'app.js')]);
  assert.equal(result.status, 0, result.stderr.toString());
});

test('PWA cache contains every required local asset', () => {
  const assets = [...sw.matchAll(/'\.\/([^']+)'/g)].map(match => match[1].split('?')[0]);
  for (const asset of assets.filter(Boolean)) {
    assert.ok(fs.existsSync(path.join(root, asset)), `Missing cached asset: ${asset}`);
  }
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(root, icon.src)), `Missing manifest icon: ${icon.src}`);
  }
});

test('Asset versions are aligned to v18', () => {
  assert.match(html, /style\.css\?v=18/);
  assert.match(html, /qa\.css\?v=18/);
  assert.match(html, /app\.js\?v=18/);
  assert.match(sw, /sever-v18/);
  assert.match(sw, /style\.css\?v=18/);
  assert.match(sw, /qa\.css\?v=18/);
  assert.match(sw, /app\.js\?v=18/);
});

test('A new user starts without personal tasks', () => {
  assert.match(app, /function freshState\(\)\{return\{version:8[^\n]+tasks:\[\]/);
  assert.doesNotMatch(app, /function freshState\(\)[^\n]+(?:Пайтон|Python|ПДД)/i);
});

test('Storage has local and IndexedDB copies plus JSON backup controls', () => {
  assert.match(app, /localStorage\.setItem\(KEY/);
  assert.match(app, /indexedDB\.open/);
  assert.match(html, /id="exportBtn"/);
  assert.match(html, /id="importInput"/);
});

test('Bottom navigation cannot be blocked by an invisible toast', () => {
  assert.match(css, /#toast\s*\{\s*pointer-events:\s*none/);
  assert.match(html, /id="toast" role="status" aria-live="polite"/);
});

test('Analytics separates focus usage and completed task volume', () => {
  assert.match(html, /id="focusMinutes"/);
  assert.match(html, /id="plannedMinutes"/);
  assert.match(app, /stats:\{focusMs:0,sessions:0\}/);
  assert.match(app, /function trackFocusElapsed/);
});

test('Large realistic state stays comfortably below localStorage quota', () => {
  const tasks = Array.from({ length: 1500 }, (_, index) => ({
    id: `task-${index}`,
    title: `Задача ${index} с нормальным пользовательским описанием`,
    date: '2026-09-03', duration: index % 2 ? 30 : null,
    category: 'Личное', completed: index % 3 === 0, priority: false
  }));
  const notes = Array.from({ length: 500 }, (_, index) => ({
    id: `note-${index}`, title: `Заметка ${index}`,
    body: 'Подробный текст заметки. '.repeat(30), kind: 'checklist',
    items: Array.from({ length: 20 }, (_, item) => ({ id: `${index}-${item}`, text: `Пункт ${item}`, done: item % 2 === 0 }))
  }));
  const started = performance.now();
  const serialized = JSON.stringify({ version: 8, tasks, notes, habits: [], checks: {}, taskMemory: [], stats: { focusMs: 0, sessions: 0 } });
  const parsed = JSON.parse(serialized);
  const elapsed = performance.now() - started;
  assert.equal(parsed.tasks.length, 1500);
  assert.equal(parsed.notes.length, 500);
  assert.ok(Buffer.byteLength(serialized) < 4_000_000, 'State is too close to common localStorage limits');
  assert.ok(elapsed < 1000, `Serialization is unexpectedly slow: ${elapsed.toFixed(1)} ms`);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error.message);
    process.exitCode = 1;
  }
}

console.log(`\n${passed}/${tests.length} checks passed`);
