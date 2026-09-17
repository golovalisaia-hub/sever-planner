import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sever2-ios-push-corefix-v1111.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness({enabled=false,existing=false,rejectSubscribe=false}={}) {
  let capture;
  let subscribeCalls=0;
  let upserts=0;
  let cloudFails=true;
  class FakeInput { constructor(){this.id='settingsNotificationToggle';this.checked=true;this.disabled=false;this.indeterminate=false;} }
  const input=new FakeInput();
  const status={textContent:'',dataset:{}};
  const state={pushReminders:{enabled,dayBefore:true,fifteenMinutes:true}};
  const device={endpoint:'https://example.invalid/subscription',toJSON:()=>({keys:{p256dh:'abc',auth:'xyz'}})};
  const registration={pushManager:{
    getSubscription:async()=>existing?device:null,
    subscribe:()=>{subscribeCalls++;return rejectSubscribe?Promise.reject(new Error('SUBSCRIBE_FAILED')):Promise.resolve(device);}
  }};
  const client={auth:{getSession:async()=>({data:{session:{user:{id:'owner'}}}})},from:()=>({upsert:async()=>{upserts++;return {error:null};}})};
  const document={documentElement:{dataset:{}},querySelector:selector=>selector==='#severReminderStatus'?status:null,addEventListener:(name,fn,phase)=>{if(name==='change'&&phase)capture=fn;}};
  const window={
    matchMedia:()=>({matches:true}),Notification:{permission:'granted'},PushManager:function(){},
    SeverApp:{getState:()=>state,persist:async()=>{}},
    SeverSupabase:{getClient:async()=>{if(cloudFails)throw new TypeError('Load failed');return client;}},
    addEventListener:()=>{},dispatchEvent:()=>true
  };
  const navigator={userAgent:'Mozilla/5.0 (iPhone)',platform:'iPhone',maxTouchPoints:1,standalone:true,serviceWorker:{ready:Promise.resolve(registration)}};
  vm.runInNewContext(source,{
    document,window,navigator,Notification:window.Notification,PushManager:window.PushManager,HTMLInputElement:FakeInput,
    Uint8Array,atob:value=>Buffer.from(value,'base64').toString('binary'),Intl,Date,Promise,
    CustomEvent:class CustomEvent{},console:{warn:()=>{}}
  });
  await tick();
  assert.equal(typeof capture,'function');
  return {input,status,state,document,get subscribeCalls(){return subscribeCalls;},get upserts(){return upserts;},restoreCloud(){cloudFails=false;},toggle(){input.checked=true;capture({target:input,preventDefault(){},stopImmediatePropagation(){}});}};
}

test('iPhone subscription survives temporary cloud failure and can be registered on a second gesture',async()=>{
  const app=await harness();
  app.toggle();
  await tick();
  assert.equal(app.subscribeCalls,1);
  assert.equal(app.state.pushReminders.enabled,false,'unconfirmed cloud write must not be called enabled');
  assert.equal(app.input.indeterminate,true,'device exists but cloud state is not confirmed');
  assert.equal(app.document.documentElement.dataset.severIosPushCloud,'unconfirmed');
  assert.match(app.status.textContent,/Подписка на iPhone существует/);
  assert.doesNotMatch(app.status.textContent,/TypeError|Load failed/);
  app.restoreCloud();
  app.toggle();
  await tick();
  assert.equal(app.subscribeCalls,1,'existing device subscription must be reused');
  assert.equal(app.upserts,1);
  assert.equal(app.input.checked,true);
  assert.equal(app.input.indeterminate,false);
  assert.equal(app.state.pushReminders.enabled,true);
  assert.equal(app.status.dataset.kind,'ok');
  assert.equal(app.document.documentElement.dataset.severIosPushCloud,undefined);
});

test('existing confirmed iPhone state is not falsely disabled by a cloud outage',async()=>{
  const app=await harness({enabled:true,existing:true});
  app.toggle();
  await tick();
  assert.equal(app.subscribeCalls,0);
  assert.equal(app.state.pushReminders.enabled,true);
  assert.equal(app.input.checked,true);
  assert.equal(app.status.dataset.kind,'warning');
  assert.equal(app.document.documentElement.dataset.severIosPushCloud,'unconfirmed');
});

test('a failed native subscribe is not represented as an existing device subscription',async()=>{
  const app=await harness({rejectSubscribe:true});
  app.toggle();
  await tick();
  assert.equal(app.state.pushReminders.enabled,false);
  assert.equal(app.input.indeterminate,false);
  assert.equal(app.document.documentElement.dataset.severIosPushCloud,undefined);
  assert.match(app.status.textContent,/Не удалось подключить/);
});
