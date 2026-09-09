import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const configPath = require.resolve('./browser/test-server-config.cjs');
function readConfig(port) {
  const env = { ...process.env };
  delete env.SEVER_E2E_PORT;
  if (port !== undefined) env.SEVER_E2E_PORT = port;
  return spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(configPath)})))`], { env, encoding: 'utf8' });
}

test('browser test origin uses the default or explicitly selected port', () => {
  for (const [input, port] of [[undefined, 41741], ['41751', 41751]]) {
    const result = readConfig(input);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { port, baseURL: `http://127.0.0.1:${port}` });
  }
});

test('browser test origin rejects invalid ports', () => {
  for (const port of ['0', '-1', '65536', '41751.5', 'invalid']) {
    const result = readConfig(port);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SEVER_E2E_PORT must be an integer/);
  }
});

test('Playwright refuses to reuse an unknown existing server', () => {
  const config = require('../playwright.config.cjs');
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.equal(new URL(config.use.baseURL).port, String(config.webServer.port));
});
