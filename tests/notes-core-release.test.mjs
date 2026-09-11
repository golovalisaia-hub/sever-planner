import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('presentation layers load deterministically through cloud recovery v80', async () => {
  const source = await read('js/theme-init.js');
  for (const asset of [
    'sever2-notes-core.css?v=71','sever2-notes-core.js?v=71',
    'sever2-notes-organization.css?v=72','sever2-notes-organization.js?v=72',
    'sever2-notes-editor-flow.css?v=73','sever2-notes-editor-flow.js?v=73',
    'sever2-notes-navigation.css?v=74','sever2-notes-navigation.js?v=74',
    'sever2-notes-polish.css?v=79','sever2-notes-polish.js?v=79',
    'sever2-mobile-consistency.css?v=76',
    'sever2-money.css?v=77','sever2-money.js?v=77',
    'sever2-interaction-polish.css?v=78','sever2-interaction-polish.js?v=78',
    'sever2-cloud-recovery.css?v=80','sever2-cloud-recovery.js?v=80'
  ]) assert.ok(source.includes(asset), `missing ${asset}`);
  assert.match(source, /data-\$\{marker\}.*v80/s);
  const core = source.indexOf('sever2-notes-core-script');
  const organization = source.indexOf('sever2-notes-organization-script');
  const editor = source.indexOf('sever2-notes-editor-flow-script');
  const navigation = source.indexOf('sever2-notes-navigation-script');
  const polish = source.indexOf('sever2-notes-polish-script');
  const money = source.indexOf('sever2-money-script');
  const interactions = source.indexOf('sever2-interaction-polish-script');
  const recovery = source.indexOf('sever2-cloud-recovery-script');
  assert.ok(core >= 0 && organization > core && editor > organization && navigation > editor && polish > navigation && money > polish && interactions > money && recovery > interactions);
});

test('cloud recovery v80 ships atomically inside the v82 reminder PWA release', async () => {
  const source = await read('sw.js');
  assert.match(source, /const CACHE = 'sever-v82-reminders-desktop-v3'/);
  for (const asset of [
    './sever2-notes-core.css?v=71','./sever2-notes-core.js?v=71',
    './sever2-notes-organization.css?v=72','./sever2-notes-organization.js?v=72',
    './sever2-notes-editor-flow.css?v=73','./sever2-notes-editor-flow.js?v=73',
    './sever2-notes-navigation.css?v=74','./sever2-notes-navigation.js?v=74',
    './sever2-notes-polish.css?v=79','./sever2-notes-polish.js?v=79',
    './sever2-mobile-consistency.css?v=76','./sever2-money.css?v=77','./sever2-money.js?v=77',
    './sever2-interaction-polish.css?v=78','./sever2-interaction-polish.js?v=78',
    './sever2-cloud-recovery.css?v=80','./sever2-cloud-recovery.js?v=80',
    './sever2-reminders.css?v=82','./sever2-task-reminders.js?v=82','./js/theme-init.js?v=81'
  ]) assert.ok(source.includes(`'${asset}'`), `missing ${asset}`);
  for (const path of [
    'sever2-notes-navigation.css','sever2-notes-navigation.js','sever2-notes-polish.css','sever2-notes-polish.js',
    'sever2-mobile-consistency.css','sever2-money.css','sever2-money.js','sever2-interaction-polish.css','sever2-interaction-polish.js',
    'sever2-cloud-recovery.css','sever2-cloud-recovery.js','sever2-reminders.css','sever2-task-reminders.js'
  ]) assert.ok(source.includes(`'/${path}'`), `missing core path ${path}`);
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