import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = async path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('v124 keeps the existing visible push handler and adds local receipt telemetry only', async () => {
  const source = await read('sw.js');
  assert.match(source, /event\.waitUntil\(self\.registration\.showNotification\(payload\.title\|\|'SEVER',options\)\)/);
  assert.match(source, /'sever-push-diagnostics-v124'/);
  assert.match(source, /self\.addEventListener\('push',event=>\{event\.waitUntil\(recordPushReceipt\(\)\.catch\(\(\)=>\{\}\)\)\}\)/);
  assert.match(source, /receivedAt:new Date\(\)\.toISOString\(\)/);
  assert.match(source, /event\.ports\?\.\[0\]\?\.postMessage\(\{type:'SEVER_PUSH_DIAG_VERSION',version:'v124'\}\)/);
  assert.doesNotMatch(source, /recordPushReceipt\([^)]*(?:payload|endpoint|auth|user_id|p256dh)/);
  assert.match(source, /key\.startsWith\('sever-'\)&&key!==CACHE/);
  assert.match(source, /url\.pathname===new URL\('\.\/push-check\.html',self\.registration\.scope\)\.pathname\)return/);
});

test('diagnostic page is separate from app navigation and exposes no subscription secrets', async () => {
  const html = await read('push-check.html');
  const client = await read('push-check.js');
  assert.match(html, /push-check\.js\?v=124/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /Последнее push-событие на устройстве/);
  assert.match(client, /registration\.pushManager\?\.getSubscription\(\)/);
  assert.match(client, /subscription\.options\?\.applicationServerKey/);
  assert.match(client, /'sever-push-diagnostics-v124'/);
  assert.match(client, /registration\.showNotification\('SEVER · локальная проверка'/);
  assert.match(client, /Ответ сервера «201» также не доказывает|Запрос на показ принят браузером/);
  assert.doesNotMatch(client, /\.textContent\s*=\s*(?:sub|subscription)\.endpoint/);
  assert.doesNotMatch(client, /(?:console\.log|fetch)\s*\(\s*(?:sub|subscription)/);
  assert.doesNotMatch(client, /unsubscribe\(|\.delete\(\)/);
});

test('iPhone opens diagnosis inside installed SEVER instead of Safari storage', async () => {
  const ios = await read('sever2-ios-push-corefix-v1111.js');
  assert.match(ios, /function installDiagnosticLink\(\)/);
  assert.match(ios, /link\.href = '\.\/push-check\.html'/);
  assert.match(ios, /test\.insertAdjacentElement\('afterend', link\)/);
  assert.match(ios, /DOMContentLoaded', installDiagnosticLink/);
  assert.match(ios, /sever:ready', \(\) => \{ void prewarm\(\); installDiagnosticLink\(\); \}/);
  assert.doesNotMatch(ios, /unsubscribe\(/);
});
