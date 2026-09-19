import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

const require=createRequire(import.meta.url);
const dispatcher=readFileSync(new URL('../../supabase/functions/sever-push-dispatch/index.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../../supabase/migrations/018_push_endpoint_allowlist.sql',import.meta.url),'utf8');

const attackerEndpoints=[
  'https://attacker.example/collect',
  'http://web.push.apple.com/x',
  'https://web.push.apple.com.attacker.example/x',
  'https://web.push.apple.com:8443/x',
  'https://user:pass@web.push.apple.com/x',
  'https://169.254.169.254/latest/meta-data/',
  'https://localhost/x'
];
const providerEndpoints=[
  'https://web.push.apple.com/abc123',
  'https://fcm.googleapis.com/fcm/send/abc123',
  'https://updates.push.services.mozilla.com/wpush/v2/abc123'
];

test('the cron dispatcher refuses to send to an endpoint outside the provider allowlist',()=>{
  assert.match(dispatcher,/function isTrustedEndpoint/);
  // Both send paths (task reminders and day rhythm) must be guarded, not just one.
  const guards=dispatcher.match(/if\(!isTrustedEndpoint\(/g)||[];
  assert.equal(guards.length,2,'every sendNotification path needs the allowlist guard');
  assert.equal((dispatcher.match(/webpush\.sendNotification\(/g)||[]).length,2);
  assert.match(dispatcher,/ENDPOINT_NOT_ALLOWED/);

  const isTrusted=new Function(`${dispatcher.match(/const PUSH_HOSTS=new Set\(\[[\s\S]*?\n\]\);/)[0]}\n${dispatcher.match(/function isTrustedEndpoint\(endpoint:string\)\{[\s\S]*?\n\}/)[0].replace(':string','')}\nreturn isTrustedEndpoint;`)();
  for(const endpoint of providerEndpoints) assert.equal(isTrusted(endpoint),true,endpoint);
  for(const endpoint of attackerEndpoints) assert.equal(isTrusted(endpoint),false,endpoint);
  assert.equal(isTrusted(''),false);
  assert.equal(isTrusted('not a url'),false);
});

test('the schema constraint rejects an untrusted endpoint in PostgreSQL',async()=>{
  const {PGlite}=require(path.join(process.env.SEVER_SQL_TEST_ROOT||path.resolve('node_modules'),'@electric-sql/pglite'));
  const db=new PGlite();
  const check=migration.match(/check \(\n\s*(endpoint ~ '[^']*')\n\s*\)/)[1];
  try{
    await db.exec(`create table push_subscriptions(id serial primary key, endpoint text not null, constraint endpoint_trusted check (${check}));`);
    for(const endpoint of providerEndpoints){
      await db.query('insert into push_subscriptions(endpoint) values($1)',[endpoint]);
    }
    for(const endpoint of attackerEndpoints){
      await assert.rejects(
        ()=>db.query('insert into push_subscriptions(endpoint) values($1)',[endpoint]),
        error=>error.code==='23514',
        endpoint
      );
    }
  } finally {
    await db.close();
  }
});
