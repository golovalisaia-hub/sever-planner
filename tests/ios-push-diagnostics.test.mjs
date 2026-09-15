import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sever2-reminder-bridge-v95.js', import.meta.url), 'utf8');
const start = source.indexOf('  function iosPushErrorText(');
const end = source.indexOf('\n  // Safari/iOS', start);
const describeError = vm.runInNewContext(`(${source.slice(start, end).trim()})`);

test('iOS push diagnostics preserve application causes hidden by Error.name', () => {
  assert.match(describeError(new Error('AUTH_REQUIRED')), /аккаунт SEVER не подтверждён/);
  assert.match(describeError(new Error('CLOUD_UNAVAILABLE')), /облако SEVER сейчас недоступно/);
  const tagged = Object.assign(new Error('generic'), { code: 'AUTH_REQUIRED' });
  assert.match(describeError(tagged), /аккаунт SEVER не подтверждён/);
});

test('iOS push creation and server persistence failures have different recovery guidance', () => {
  const error = new Error('private endpoint and server response must stay private');
  assert.match(describeError(error, 'subscription'), /создать push-подписку/);
  assert.match(describeError(error, 'save'), /не удалось сохранить подключение/);
  assert.doesNotMatch(describeError(error, 'save'), /private endpoint/);
  assert.match(describeError({ name: 'NotAllowedError' }), /не разрешил уведомления/);
  assert.match(describeError({ name: 'InvalidStateError' }), /несовместимую старую/);
});
