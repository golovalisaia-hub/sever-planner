import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Notes core and organization layers are loaded by the SEVER 2 presentation bootstrap', async () => {
  const source = await read('js/theme-init.js');
  assert.match(source, /sever2-notes-core\.css\?v=71/);
  assert.match(source, /sever2-notes-core\.js\?v=71/);
  assert.match(source, /sever2-notes-organization\.css\?v=72/);
  assert.match(source, /sever2-notes-organization\.js\?v=72/);
  assert.match(source, /data-\$\{marker\}.*v72/s);
});

test('Notes organization ships in the atomic PWA release', async () => {
  const source = await read('sw.js');
  assert.match(source, /const CACHE = 'sever-v68-notes-organization-v1'/);
  assert.match(source, /\.\/sever2-notes-core\.css\?v=71/);
  assert.match(source, /\.\/sever2-notes-core\.js\?v=71/);
  assert.match(source, /\.\/sever2-notes-organization\.css\?v=72/);
  assert.match(source, /\.\/sever2-notes-organization\.js\?v=72/);
  assert.match(source, /'\/sever2-notes-organization\.css'/);
  assert.match(source, /'\/sever2-notes-organization\.js'/);
  assert.match(source, /\.\/js\/theme-init\.js\?v=72/);
});

test('Notes organization keeps pin and tags outside the notes table contract', async () => {
  const source = await read('sever2-notes-organization.js');
  assert.match(source, /const ORGANIZATION_KEY = 'noteOrganization'/);
  assert.match(source, /state\.profile\[ORGANIZATION_KEY\]/);
  assert.doesNotMatch(source, /note\.pinned\s*=/);
  assert.doesNotMatch(source, /note\.tags\s*=/);
  assert.match(source, /note\.protected \? \[\] : normalizeTags/);
  assert.match(source, /window\.SeverNotesOrganization/);
  assert.match(source, /typeof save === 'function'/);
});
