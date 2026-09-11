import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

test('Notes editor flow has valid JavaScript syntax', () => {
  const file = path.join(root, 'sever2-notes-editor-flow.js');
  assert.ok(fs.existsSync(file));
  const result = spawnSync(process.execPath, ['--check', file]);
  assert.equal(result.status, 0, result.stderr.toString());
});
