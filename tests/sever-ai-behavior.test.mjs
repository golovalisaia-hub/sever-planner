import test from 'node:test';
import assert from 'node:assert/strict';
import { day, clock, number, object } from '../supabase/functions/sever-ai/validation.ts';
import { signAction, verifyAction } from '../supabase/functions/sever-ai/confirmation.ts';
import { calculatePlan } from '../supabase/functions/sever-ai/plans.ts';
import { executeTool } from '../supabase/functions/sever-ai/tools.ts';
import { createHandler } from '../supabase/functions/sever-ai/handler.ts';
import { GroqProvider, providerConfig } from '../supabase/functions/sever-ai/provider.ts';
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const secret='unit-test-secret-not-a-production-key';
test('AI edits versioned tasks with field clock and optimistic precondition',async()=>{
  const meta={v:1,life:{generation:0,deleted:false,stamp:[1000,'A']},fields:{title:[1000,'A'],category:[1000,'A']}};
  const h=harness({row:{id:other,title:'Before',category:'Home',sync_versions:meta}});
  await executeTool(h.db,user,'task.update',{taskId:other,title:'After'});
  const call=h.calls.find(c=>c.write);
  assert.equal(call.write.title,'After');
  assert.ok(call.write.sync_versions.fields.title[0]>1000);
  assert.deepEqual(call.write.sync_versions.fields.category,meta.fields.category);
  assert.ok(call.filters.some(([k,v])=>k==='sync_versions'&&v===JSON.stringify(meta)));
});
test('AI delete stamps lifecycle without bypassing account ownership',async()=>{
  const meta={v:1,life:{generation:0,deleted:false,stamp:[1000,'A']},fields:{content:[1000,'A']}};
  const h=harness({row:{id:other,title:'Note',protected:false,sync_versions:meta}});
  await executeTool(h.db,user,'note.delete',{noteId:other},{confirmed:true});
  const call=h.calls.find(c=>c.write);
  assert.equal(call.write.sync_versions.life.deleted,true);
  assert.ok(call.filters.some(([k,v])=>k==='user_id'&&v===user));
});
function harness({role='user',row=null,dbError=false,authError=false,reply,quota=true}={}) {
  const calls=[];
  const db={auth:{getUser:async()=>({data:{user:authError?null:{id:user}},error:authError?{}:null})},rpc:async(name,args)=>{calls.push({name,args});return {data:quota,error:null};},from(table){
    const call={table,filters:[],write:null};calls.push(call);
    const chain={select(){return chain;},eq(...args){call.filters.push(args);return chain;},is(){return chain;},order(){return chain;},limit(){return chain;},gte(){return chain;},lte(){return chain;},insert(value){call.write=value;return chain;},update(value){call.write=value;return chain;},upsert(value){call.write=value;return chain;},delete(){call.write='delete';return chain;},single:async()=>({data:table==='profiles'?{role}:row,error:dbError&&table!=='profiles'?{}:null}),maybeSingle:async()=>({data:row,error:dbError?{}:null}),then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}};return chain;
  }};
  const handler=createHandler({createClient:()=>db,env:key=>({AI_CONFIRMATION_SECRET:secret,GROQ_API_KEY:'test',SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'public'})[key],providerFactory:()=>({provider:{complete:async input=>{calls.push({provider:true,input});input.onText?.('Предварительный текст');return {reply:reply||{message:'Привет',toolCall:null},usage:{}};}}})});
  const request=(body={},headers={})=>new Request('https://test.invalid/functions/v1/sever-ai',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json',...headers},body:JSON.stringify({requestId:crypto.randomUUID(),message:'задача',...body})});
  return {handler,request,calls,db};
}
test('validation rejects impossible dates, time injection, NaN and identity fields',()=>{
  for(const date of ['2026-02-30','2026-13-01','tomorrow'])assert.throws(()=>day(date));
  assert.equal(day('2028-02-29'),'2028-02-29');
  for(const value of ['24:00','<img src=x>','18:60'])assert.throws(()=>clock(value));
  assert.equal(clock('18:00'),'18:00');assert.throws(()=>number(NaN,0,5));
  assert.throws(()=>object({userId:other}));assert.throws(()=>object({role:'owner'}));
});
test('confirmation is bound to account, signature and expiry',async()=>{
  const signed=await signAction({name:'task.delete',arguments:{taskId:other}},user,secret,1000);
  assert.equal((await verifyAction(signed.token,user,secret,1001)).name,'task.delete');
  await assert.rejects(()=>verifyAction(signed.token,other,secret,1001));
  await assert.rejects(()=>verifyAction(signed.token,user,secret,601001));
  const [payload,sig]=signed.token.split('.');const forged=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(payload,'base64url')),name:'plan.create'})).toString('base64url');
  await assert.rejects(()=>verifyAction(forged+'.'+sig,user,secret,1001));
});
test('financial plan uses exact cents and clamps month ends',()=>{
  const result=calculatePlan({kind:'financial_goal',title:'Накопления',targetAmount:40000,monthlyBudget:7000,startDate:'2026-01-31'},'2026-01-01');
  assert.equal(result.tasks.length,6);assert.equal(result.plan.data.schedule[1].date,'2026-02-28');assert.equal(result.plan.data.schedule.at(-1).amount,5000);
  assert.equal(result.plan.data.schedule.reduce((sum,p)=>sum+Math.round(p.amount*100),0),4000000);
  assert.throws(()=>calculatePlan({kind:'financial_goal',title:'Долг',targetAmount:100,monthlyBudget:0},'2026-01-01'));
});
test('USER cannot execute OWNER tools',async()=>{
  await assert.rejects(()=>executeTool({},user,'ai.getUsage',{}, {role:'user'}),{code:'TOOL_DENIED',status:403});
});
test('IDOR query is user scoped and missing records fail closed',async()=>{
  const h=harness();await assert.rejects(()=>executeTool(h.db,user,'task.get',{taskId:other}),{code:'NOT_FOUND'});
  assert.deepEqual(h.calls[0].filters,[['id',other],['user_id',user]]);
});
test('protected note is never returned',async()=>{
  const h=harness({row:{id:other,protected:true,body:'private'}});
  await assert.rejects(()=>executeTool(h.db,user,'note.get',{noteId:other}),{code:'PROTECTED_NOTE'});
});
test('missing auth, spoofed role and disallowed origin are rejected before provider',async()=>{
  for(const [options,body,headers,expected] of [[{authError:true},{},{},401],[{},{role:'owner'},{},422],[{},{},{Origin:'https://evil.invalid'},403]]){
    const h=harness(options),res=await h.handler(h.request(body,headers));assert.equal(res.status,expected);assert.ok(!h.calls.some(c=>c.provider));
  }
});
test('model cannot invoke OWNER tools for USER',async()=>{
  const h=harness({reply:{message:'Успех',toolCall:{name:'ai.getUsage',arguments:{}}}});
  const res=await h.handler(h.request());assert.equal(res.status,403);assert.equal((await res.json()).error,'TOOL_DENIED');
});
test('DB failure does not produce model success text',async()=>{
  const h=harness({dbError:true,reply:{message:'Задача добавлена!',toolCall:{name:'task.create',arguments:{title:'Тест',date:'2026-09-08'}}}});
  const res=await h.handler(h.request());assert.equal(res.status,503);const data=await res.json();assert.equal(data.error,'DATABASE_ERROR');assert.notEqual(data.message,'Задача добавлена!');
});
test('stream emits delta then canonical final after successful write',async()=>{
  const h=harness({row:{id:other,title:'Тест'},reply:{message:'Сейчас попробую',toolCall:{name:'task.create',arguments:{title:'Тест',date:'2026-09-08'}}}});
  const res=await h.handler(h.request({}, {Accept:'text/event-stream'}));const stream=await res.text();
  assert.match(stream,/event: delta/);assert.match(stream,/event: final/);assert.match(stream,/Задача добавлена/);assert.ok(stream.indexOf('event: delta')<stream.indexOf('event: final'));
});
test('destructive action produces a signed preview without writes',async()=>{
  const h=harness({row:{id:other,title:'Тест'},reply:{message:'Удалено',toolCall:{name:'task.delete',arguments:{taskId:other}}}});
  const res=await h.handler(h.request());const data=await res.json();assert.ok(data.pendingAction.token);assert.equal(data.result,null);assert.ok(!h.calls.some(c=>c.write));
});
test('rate limit prevents provider call',async()=>{
  const h=harness({quota:false});assert.equal((await h.handler(h.request())).status,429);assert.ok(!h.calls.some(c=>c.provider));
});
test('provider parses split UTF-8/SSE chunks, rejects truncated stream and retries only 502/503',async()=>{
  const original=globalThis.fetch;
  const reply={message:'Привет, мир',intent:'answer',supportLevel:0,toolCall:null};
  const wire='data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(reply)}}]})+'\n\ndata: [DONE]\n\n';
  function response(value){const bytes=new TextEncoder().encode(value);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}));}
  try{
    let calls=0;globalThis.fetch=async()=>++calls===1?new Response('',{status:503}):response(wire);
    const values=[],result=await new GroqProvider('test','test','https://example.test/v1/chat/completions').complete({system:'test',message:'test',context:{},onText:s=>values.push(s)});
    assert.equal(calls,2);assert.equal(result.reply.message,reply.message);assert.equal(values.at(-1),reply.message);
    globalThis.fetch=async()=>response(wire.replace('data: [DONE]',''));
    await assert.rejects(()=>new GroqProvider('test','test','https://example.test/v1/chat/completions').complete({system:'test',message:'test',context:{}}),{code:'PROVIDER_ERROR'});
  }finally{globalThis.fetch=original;}
});
test('Groq free-tier provider is the default and reads only its server secret',()=>{
  const config=providerConfig(key=>({GROQ_API_KEY:'server-secret'}[key]));
  assert.deepEqual(config,{name:'groq',model:'openai/gpt-oss-20b',key:'server-secret',url:undefined});
});
