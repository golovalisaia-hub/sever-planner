import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [themeInit, serviceWorker, polishJs, polishCss] = await Promise.all([
  readFile(new URL('../js/theme-init.js', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../sever2-notes-polish.js', import.meta.url), 'utf8'),
  readFile(new URL('../sever2-notes-polish.css', import.meta.url), 'utf8')
]);

test('Notes polish v75 is loaded after prior Notes layers', () => {
  assert.match(themeInit, /sever2-notes-navigation\.js\?v=74[\s\S]*sever2-notes-polish\.js\?v=75/);
  assert.match(themeInit, /sever2-notes-navigation\.css\?v=74[\s\S]*sever2-notes-polish\.css\?v=75/);
  assert.match(themeInit, /data-\$\{marker\}.*, 'v75'/);
});

test('PWA release caches Notes polish and theme bootstrap atomically', () => {
  assert.match(serviceWorker, /sever-v71-notes-polish-v1/);
  for (const asset of [
    'sever2-notes-polish.css?v=75',
    'sever2-notes-polish.js?v=75',
    'js/theme-init.js?v=75'
  ]) assert.match(serviceWorker, new RegExp(asset.replace(/[.?]/g, match => `\\${match}`)));
});

test('long checklist continuation is an actual button and bulk action leaves footer', () => {
  assert.match(polishJs, /document\.createElement\('button'\)/);
  assert.match(polishJs, /notes-polish-expand/);
  assert.match(polishJs, /notes-polish-checklist-tools/);
  assert.match(polishCss, /notes-polish-expanded/);
  assert.match(polishCss, /min-width: 44px/);
  assert.match(polishCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});
