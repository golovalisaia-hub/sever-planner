import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createECDH, timingSafeEqual } from 'node:crypto';

const source=readFileSync(new URL('../supabase/functions/sever-push-health/index.ts',import.meta.url),'utf8');

test('key check is cron-token-only and never sends notifications or mutates subscriptions',()=>{
  assert.match(source,/req\.method!=='POST'/);
  assert.match(source,/x-sever-cron-token/);
  assert.match(source,/timingSafeEqual\(left,right\)/);
  assert.match(source,/return json\(\{error:'UNAUTHORIZED'\},401\)/);
  assert.match(source,/return json\(\{ok:true,\.\.\.inspectPair\(/);
  assert.match(source,/createECDH\('prime256v1'\)/);
  assert.match(source,/getPublicKey\(undefined,'uncompressed'\)/);
  assert.doesNotMatch(source,/sendNotification|\.unsubscribe\(|\.insert\(|\.update\(|\.delete\(|console\.log|console\.error|console\.warn/);
  // Internal secret references are expected as arguments to inspectPair();
  // reject serialization of raw secrets as named response properties instead.
  assert.doesNotMatch(source,/return json\(\{\s*(?:vapid_public|vapid_private|cron_token)\s*:/);
  assert.match(source,/return \{ publicKeyValid, privateKeyValid, keyPairMatches:/);
});

test('P-256 derivation distinguishes valid and mismatched pairs without returning private keys',()=>{
  const a=createECDH('prime256v1');
  const b=createECDH('prime256v1');
  a.generateKeys(); b.generateKeys();
  const derived=createECDH('prime256v1');
  derived.setPrivateKey(a.getPrivateKey());
  const point=derived.getPublicKey(undefined,'uncompressed');
  assert.equal(point.length,65);
  assert.equal(timingSafeEqual(point,a.getPublicKey(undefined,'uncompressed')),true);
  assert.equal(timingSafeEqual(point,b.getPublicKey(undefined,'uncompressed')),false);
  assert.ok(a.getPrivateKey().length>0 && a.getPrivateKey().length<=32);
});
