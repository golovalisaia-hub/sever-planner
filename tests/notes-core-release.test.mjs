import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('presentation layers load deterministically through Money v77', async () => {
  const source = await read('js/theme-init.js');
  for (const asset of [
    'sever2-notes-core.css?v=71','sever2-notes-core.js?v=71',
    'sever2-notes-organization.css?v=72','sever2-notes-organization.js?v=72',
    'sever2-notes-editor-flow.css?v=73','sever2-notes-editor-flow.js?v=73',
    'sever2-notes-navigation.css?v=74','sever2-notes-navigation.js?v=74',
    'sever2-notes-polish.css?v=75','sever2-notes-polish.js?v=75',
    'sever2-mobile-consistency.css?v=76',
    'sever2-money.css?v=77','sever2-money.js?v=77'
  ]) assert.ok(source.includes(asset), `missing ${asset}`);
  assert.match(source, /data-\$\{marker\}.*v77/s);
  const core = source.indexOf('sever2-notes-core-script');
  const organization = source.indexOf('sever2-notes-organization-script');
  const editor = source.indexOf('sever2-notes-editor-flow-script');
  const navigation = source.indexOf('sever2-notes-navigation-script');
  const polish = source.indexOf('sever2-notes-polish-script');
  const money = source.indexOf('sever2-money-script');
  assert.ok(core >= 0 && organization > core && editor > organization && navigation > editor && polish > navigation && money > polish);
});

test('Money v77 ships in the atomic PWA release without dropping prior Notes layers', async () => {
  const source = await read('sw.js');
  assert.match(source, /const CACHE = 'sever-v73-money-v1'/);
  for (const asset of [
    './sever2-notes-core.css?v=71','./sever2-notes-core.js?v=71',
    './sever2-notes-organization.css?v=72','./sever2-notes-organization.js?v=72',
    './sever2-notes-editor-flow.css?v=73','./sever2-notes-editor-flow.js?v=73',
    './sever2-notes-navigation.css?v=74','./sever2-notes-navigation.js?v=74',
    './sever2-notes-polish.css?v=75','./sever2-notes-polish.js?v=75',
    './sever2-mobile-consistency.css?v=76','./sever2-money.css?v=77','./sever2-money.js?v=77','./js/theme-init.js?v=77'
  ]) assert.ok(source.includes(`'${asset}'`), `missing ${asset}`);
  assert.match(source, /'\/sever2-notes-navigation\.css'/);
  assert.match(source, /'\/sever2-notes-navigation\.js'/);
  assert.match(source, /'\/sever2-notes-polish\.css'/);
  assert.match(source, /'\/sever2-notes-polish\.js'/);
  assert.match(source, /'\/sever2-mobile-consistency\.css'/);
  assert.match(source, /'\/sever2-money\.css'/);
  assert.match(source, /'\/sever2-money\.js'/);
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
