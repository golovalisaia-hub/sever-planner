import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/security.yml', import.meta.url), 'utf8');

test('v117 runs expensive regression once per PR and separately on main', () => {
  assert.match(workflow, /on:\s*\n  push:\s*\n    branches: \[main\]\s*\n  pull_request:/);
  assert.doesNotMatch(workflow, /push:\s*\n  pull_request:/);
});

test('v117 cancels only superseded PR runs and isolates other workflows and main', () => {
  assert.match(workflow, /concurrency:\s*\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.head_ref \|\| github\.ref \}\}/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
});

test('v117 retains the complete browser, security, sync and backend gates', () => {
  for (const name of ['Planner, cloud, AI and ownership regression', 'Browser E2E (phones and desktop)', 'Concurrent sync (isolated PostgreSQL and desktop/mobile contexts)', 'Security suite', 'Secret scan', 'Backend tests']) {
    assert.ok(workflow.includes(`- name: ${name}`), `Missing CI gate: ${name}`);
  }
});
