import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Notes core, organization and editor-flow layers load in the SEVER 2 presentation bootstrap', async () => {
  const source = await read('js/theme-init.js');
  assert.match(source, /sever2-notes-core\.css\?v=71/);
  assert.match(source, /sever2-notes-core\.js\?v=71/);
  assert.match(source, /sever2-notes-organization\.css\?v=72/);
  assert.match(source, /sever2-notes-organization\.js\?v=72/);
  assert.match(source, /sever2-notes-editor-flow\.css\?v=73/);
  assert.match(source, /sever2-notes-editor-flow\.js\?v=73/);
  assert.match(source, /data-\$\{marker\}.*v73/s);

  const coreIndex = source.indexOf('sever2-notes-core-script');
  const organizationIndex = source.indexOf('sever2-notes-organization-script');
  const editorFlowIndex = source.indexOf('sever2-notes-editor-flow-script');
  assert.ok(coreIndex >= 0 && organizationIndex > coreIndex && editorFlowIndex > organizationIndex);
});

test('Notes editor flow ships in the atomic PWA release without dropping organization assets', async () => {
  const source = await read('sw.js');
  assert.match(source, /const CACHE = 'sever-v69-notes-editor-flow-v1'/);
  assert.match(source, /\.\/sever2-notes-core\.css\?v=71/);
  assert.match(source, /\.\/sever2-notes-core\.js\?v=71/);
  assert.match(source, /\.\/sever2-notes-organization\.css\?v=72/);
  assert.match(source, /\.\/sever2-notes-organization\.js\?v=72/);
  assert.match(source, /\.\/sever2-notes-editor-flow\.css\?v=73/);
  assert.match(source, /\.\/sever2-notes-editor-flow\.js\?v=73/);
  assert.match(source, /'\/sever2-notes-organization\.css'/);
  assert.match(source, /'\/sever2-notes-organization\.js'/);
  assert.match(source, /'\/sever2-notes-editor-flow\.css'/);
  assert.match(source, /'\/sever2-notes-editor-flow\.js'/);
  assert.match(source, /\.\/js\/theme-init\.js\?v=73/);
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
