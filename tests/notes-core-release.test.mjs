import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Notes core is loaded by the SEVER 2 presentation bootstrap', async () => {
  const source = await read('js/theme-init.js');
  assert.match(source, /sever2-notes-core\.css\?v=71/);
  assert.match(source, /sever2-notes-core\.js\?v=71/);
  assert.match(source, /data-\$\{marker\}.*v71/s);
});

test('Notes core ships in the atomic PWA release', async () => {
  const source = await read('sw.js');
  assert.match(source, /const CACHE = 'sever-v67-notes-core-v1'/);
  assert.match(source, /\.\/sever2-notes-core\.css\?v=71/);
  assert.match(source, /\.\/sever2-notes-core\.js\?v=71/);
  assert.match(source, /'\/sever2-notes-core\.css'/);
  assert.match(source, /'\/sever2-notes-core\.js'/);
  assert.match(source, /\.\/js\/theme-init\.js\?v=71/);
});

test('Notes core keeps the existing data contract intact', async () => {
  const source = await read('sever2-notes-core.js');
  assert.doesNotMatch(source, /pinned\s*:/);
  assert.doesNotMatch(source, /tags\s*:/);
  assert.match(source, /window\.SeverApp\?\.getState/);
  assert.match(source, /window\.SeverNotes\?\.render/);
  assert.match(source, /typeof save === 'function'/);
});
