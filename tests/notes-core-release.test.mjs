import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('presentation layers load deterministically through mobile consistency v76', async () => {
  const source = await read('js/theme-init.js');
  for (const asset of [
    'sever2-notes-core.css?v=71','sever2-notes-core.js?v=71',
    'sever2-notes-organization.css?v=72','sever2-notes-organization.js?v=72',
    'sever2-notes-editor-flow.css?v=73','sever2-notes-editor-flow.js?v=73',
    'sever2-notes-navigation.css?v=74','sever2-notes-navigation.js?v=74',
    'sever2-notes-polish.css?v=75','sever2-notes-polish.js?v=75',
    'sever2-mobile-consistency.css?v=76'
  ]) assert.ok(source.includes(asset), `missing ${asset}`);
  assert.match(source, /data-\$\{marker\}.*v76/s);
  const core = source.indexOf('sever2-notes-core-script');
  const organization = source.indexOf('sever2-notes-organization-script');
  const editor = source.indexOf('sever2-notes-editor-flow-script');
  const navigation = source.indexOf('sever2-notes-navigation-script');
  const polish = source.indexOf('sever2-notes-polish-script');
  assert.ok(core >= 0 && organization > core && editor > organization && navigation > editor && polish > navigation);
});

test('mobile consistency ships in the atomic PWA release without dropping prior Notes layers', async () => {
  const source = await read('sw.js');
  assert.match(source, /const CACHE = 'sever-v72-mobile-consistency-v1'/);
  for (const asset of [
    './sever2-notes-core.css?v=71','./sever2-notes-core.js?v=71',
    './sever2-notes-organization.css?v=72','./sever2-notes-organization.js?v=72',
    './sever2-notes-editor-flow.css?v=73','./sever2-notes-editor-flow.js?v=73',
    './sever2-notes-navigation.css?v=74','./sever2-notes-navigation.js?v=74',
    './sever2-notes-polish.css?v=75','./sever2-notes-polish.js?v=75',
    './sever2-mobile-consistency.css?v=76','./js/theme-init.js?v=76'
  ]) assert.ok(source.includes(`'${asset}'`), `missing ${asset}`);
  assert.match(source, /'\/sever2-notes-navigation\.css'/);
  assert.match(source, /'\/sever2-notes-navigation\.js'/);
  assert.match(source, /'\/sever2-notes-polish\.css'/);
  assert.match(source, /'\/sever2-notes-polish\.js'/);
  assert.match(source, /'\/sever2-mobile-consistency\.css'/);
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
