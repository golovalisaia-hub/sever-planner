import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source = await readFile(new URL('../push-repair.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../push-check.html', import.meta.url), 'utf8');
const key = source.match(/const CURRENT_KEY = '([^']+)'/)?.[1];
assert.ok(key, 'public VAPID key must be present');
const expected = Uint8Array.from(Buffer.from(key, 'base64url'));

function harness({stale=true, unknown=false, auth=true, disabledError=false, unsubscribeOk=true}={}) {
  const recorded=[];
  const button={hidden:true,disabled:false,listener:null,addEventListener(_type,listener){this.listener=listener}};
  const next={hidden:true};
  const result={textContent:''};
  const refreshButton={addEventListener(){}};
  const controls={repairSubscription:button,repairNext:next,message:result,refresh:refreshButton};
  const old=new Uint8Array(expected);
  if(stale) old[10] ^= 1;
  let subscription={endpoint:'https://push.example.invalid/device',options:{applicationServerKey:unknown?null:old},async unsubscribe(){recorded.push('unsubscribe');if(unsubscribeOk)subscription=null;return unsubscribeOk}};
  const rows=(operation,error=false)=>({
    eq(field,value){recorded.push(`${operation}:${field}:${value}`);return this},
    then(resolve){recorded.push(operation);return Promise.resolve({error:error?{code:'DENIED'}:null}).then(resolve)}
  });
  const client={
    auth:{async getUser(){recorded.push('getUser');return auth?{data:{user:{id:'signed-in-owner'}},error:null}:{data:{user:null},error:{code:'NO_SESSION'}}}},
    from(name){assert.equal(name,'push_subscriptions');return {
      update(value){assert.deepEqual(value,{enabled:false});return rows('disable',disabledError)},
      delete(){return rows('delete')}
    }}
  };
  const registration={pushManager:{async getSubscription(){recorded.push('getSubscription');return subscription}}};
  const context={
    Uint8Array,Promise,
    atob:value=>Buffer.from(value,'base64').toString('binary'),
    document:{getElementById:id=>controls[id] || null},
    navigator:{serviceWorker:{async getRegistration(){recorded.push('getRegistration');return registration}}},
    window:{SeverSupabase:{async getClient(){recorded.push('getClient');return client}}}
  };
  runInNewContext(source,context,{filename:'push-repair.js'});
  return {button,next,result,recorded,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('repair controls require actual byte-level VAPID mismatch, not a missing key',async()=>{
  for(const options of [{stale:false},{unknown:true}]){
    const h=harness(options);
    await h.flush();
    assert.equal(h.button.hidden,true);
    h.button.listener(); // Even a synthetic invocation must fail closed.
    await h.flush();
    assert.equal(h.recorded.includes('getClient'),false);
    assert.equal(h.recorded.includes('unsubscribe'),false);
  }
});

test('confirmed mismatch disables only signed-in owner endpoint, unsubs and deletes exactly once',async()=>{
  const h=harness();
  await h.flush();
  assert.equal(h.button.hidden,false);
  h.button.listener();
  await h.flush();
  assert.deepEqual(h.recorded.filter(item=>['disable','unsubscribe','delete'].includes(item)),['disable','unsubscribe','delete']);
  assert.equal(h.recorded.filter(item=>item==='disable:user_id:signed-in-owner').length,1);
  assert.equal(h.recorded.filter(item=>item==='delete:user_id:signed-in-owner').length,1);
  assert.equal(h.recorded.filter(item=>item==='disable:endpoint:https://push.example.invalid/device').length,1);
  assert.equal(h.recorded.filter(item=>item==='delete:endpoint:https://push.example.invalid/device').length,1);
  assert.equal(h.button.hidden,true);
  assert.equal(h.next.hidden,false);
  assert.match(h.result.textContent,/Вернитесь в настройки/);
});

test('server denial preserves browser subscription and refuses to claim success',async()=>{
  const h=harness({disabledError:true});
  await h.flush();
  h.button.listener();
  await h.flush();
  assert.equal(h.recorded.includes('unsubscribe'),false);
  assert.equal(h.recorded.includes('delete'),false);
  assert.equal(h.next.hidden,true);
  assert.match(h.result.textContent,/не изменена/);
});

test('missing auth never changes browser subscription or cloud records',async()=>{
  const h=harness({auth:false});
  await h.flush();
  h.button.listener();
  await h.flush();
  assert.equal(h.recorded.some(item=>item==='disable'||item==='unsubscribe'||item==='delete'),false);
  assert.match(h.result.textContent,/Войдите/);
});

test('failed browser unsubscribe never claims successful repair or deletes record',async()=>{
  const h=harness({unsubscribeOk:false});
  await h.flush();
  h.button.listener();
  await h.flush();
  assert.equal(h.recorded.includes('disable'),true);
  assert.equal(h.recorded.includes('unsubscribe'),true);
  assert.equal(h.recorded.includes('delete'),false);
  assert.equal(h.next.hidden,true);
  assert.match(h.result.textContent,/запись отключена/);
});

test('diagnostic repair remains opt-in, owner-scoped and isolated from task data',()=>{
  assert.match(html,/id="repairSubscription"[^>]*hidden/);
  assert.match(html,/\[hidden\]\{display:none!important\}/);
  assert.match(html,/push-repair\.js\?v=125/);
  assert.match(html,/connect-src 'self' https:\/\/vdhazibkfpgclcwyvvbi\.supabase\.co/);
  assert.match(source,/client\.auth\.getUser\(\)/);
  assert.match(source,/keyIsStale\(subscription\)/);
  assert.match(source,/\.eq\('user_id', userId\)\.eq\('endpoint', subscription\.endpoint\)/);
  assert.doesNotMatch(source,/(?:console\.|localStorage|sessionStorage|pushManager\.subscribe|from\('tasks'\))/);
});
