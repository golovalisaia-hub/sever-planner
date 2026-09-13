import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { executeTool, needsConfirmation } from '../supabase/functions/sever-ai/tools.ts';
import { toolsFor, SEVER_MANIFEST } from '../supabase/functions/sever-ai/manifest.ts';
import { versionedPatch } from '../supabase/functions/sever-ai/sync-versions.ts';
import { resultMessage } from '../supabase/functions/sever-ai/handler.ts';

const root=path.resolve(import.meta.dirname,'..');
const client=fs.readFileSync(path.join(root,'js/sever-ai.js'),'utf8');
const handler=fs.readFileSync(path.join(root,'supabase/functions/sever-ai/handler.ts'),'utf8');
const provider=fs.readFileSync(path.join(root,'supabase/functions/sever-ai/provider.ts'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const user='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const habitId='33333333-3333-4333-8333-333333333333';
const entryId='44444444-4444-4444-8444-444444444444';

function database(seed={}) {
  const tables=structuredClone(seed),calls=[];
  const matches=(row,filters)=>filters.every(([kind,key,value])=>kind==='is'?row?.[key]==null: key==='sync_versions'&&typeof value==='string'?JSON.stringify(row?.[key])===value:row?.[key]===value);
  const from=table=>{
    const filters=[];let mode='read',write=null;
    const chain={
      select(){return chain;},eq(key,value){filters.push(['eq',key,value]);return chain;},is(key,value){filters.push(['is',key,value]);return chain;},
      order(){return chain;},limit(){return chain;},gte(){return chain;},lte(){return chain;},
      insert(value){mode='insert';write=structuredClone(value);calls.push({table,mode,write,filters});return chain;},
      update(value){mode='update';write=structuredClone(value);calls.push({table,mode,write,filters});return chain;},
      upsert(value){mode='upsert';write=structuredClone(value);calls.push({table,mode,write,filters});return chain;},
      delete(){mode='delete';calls.push({table,mode,filters});return chain;},
      async maybeSingle(){return {data:(tables[table]||[]).find(row=>matches(row,filters))||null,error:null};},
      async single(){
        if(mode==='insert'){const row=structuredClone(write);(tables[table]??=[]).push(row);return {data:row,error:null};}
        if(mode==='update'){const row=(tables[table]||[]).find(row=>matches(row,filters));if(!row)return {data:null,error:{message:'not found'}};Object.assign(row,structuredClone(write));return {data:structuredClone(row),error:null};}
        return {data:(tables[table]||[]).find(row=>matches(row,filters))||null,error:null};
      },
      then(resolve,reject){return Promise.resolve({data:(tables[table]||[]).filter(row=>matches(row,filters)),error:null}).then(resolve,reject);}
    };
    return chain;
  };
  return {db:{from},tables,calls};
}

function meta({deleted=false,generation=0}={}) {return {v:1,life:{generation,deleted,stamp:[1000,'A']},fields:{title:[1000,'A'],completion:[1000,'A']}};}

test('v100 exposes habit tools to users and makes delete confirmable',()=>{
  for(const name of ['habit.list','habit.create','habit.update','habit.check','habit.delete'])assert.ok(SEVER_MANIFEST.userTools.includes(name));
  const pageTools=toolsFor('habits','user','');
  for(const name of ['habit.list','habit.create','habit.update','habit.check','habit.delete'])assert.ok(pageTools.includes(name));
  assert.ok(toolsFor('today','user','отметь привычку').includes('habit.check'));
  assert.equal(needsConfirmation('habit.delete'),true);
});

test('versioned habit writes update field clocks and can restore a tombstoned completion',()=>{
  const habit={title:'До',deleted_at:null,sync_versions:meta()};
  const changed=versionedPatch('habits',habit,{title:'После'},2000);
  assert.notDeepEqual(changed.sync_versions.fields.title,habit.sync_versions.fields.title);
  const entry={completed:false,deleted_at:'2026-09-12T10:00:00.000Z',sync_versions:meta({deleted:true,generation:2})};
  const restored=versionedPatch('habit_entries',entry,{completed:true,deleted_at:null},3000);
  assert.equal(restored.sync_versions.life.deleted,false);
  assert.equal(restored.sync_versions.life.generation,3);
  assert.notDeepEqual(restored.sync_versions.fields.completion,entry.sync_versions.fields.completion);
});

test('habit update is account scoped and versioned',async()=>{
  const h=database({habits:[{id:habitId,user_id:user,title:'До',deleted_at:null,sync_versions:meta()}]});
  const result=await executeTool(h.db,user,'habit.update',{habitId,title:'После'},{today:'2026-09-13'});
  assert.equal(result.title,'После');
  const call=h.calls.find(call=>call.table==='habits'&&call.mode==='update');
  assert.ok(call);
  assert.ok(call.filters.some(([,key,value])=>key==='user_id'&&value===user));
  assert.notDeepEqual(call.write.sync_versions.fields.title,meta().fields.title);
});

test('habit IDOR fails closed',async()=>{
  const h=database({habits:[{id:habitId,user_id:other,title:'Чужая',deleted_at:null}]});
  await assert.rejects(()=>executeTool(h.db,user,'habit.update',{habitId,title:'Нет'},{today:'2026-09-13'}),{code:'NOT_FOUND'});
  assert.equal(h.calls.filter(call=>call.mode==='update').length,0);
});

test('habit check rejects future dates before writing',async()=>{
  const h=database({habits:[{id:habitId,user_id:user,title:'ПДД',deleted_at:null}]});
  await assert.rejects(()=>executeTool(h.db,user,'habit.check',{habitId,date:'2026-09-14',completed:true},{today:'2026-09-13'}),{code:'VALIDATION'});
  assert.equal(h.calls.filter(call=>['insert','update'].includes(call.mode)).length,0);
});

test('habit check is deterministic: create, tombstone, then versioned restore',async()=>{
  const fresh=database({habits:[{id:habitId,user_id:user,title:'ПДД',deleted_at:null}],habit_entries:[]});
  const first=await executeTool(fresh.db,user,'habit.check',{habitId,date:'2026-09-13',completed:true},{today:'2026-09-13'});
  assert.equal(first.completed,true);
  assert.equal(fresh.tables.habit_entries[0].user_id,user);

  const live=database({habits:[{id:habitId,user_id:user,title:'ПДД',deleted_at:null}],habit_entries:[{id:entryId,user_id:user,habit_id:habitId,entry_date:'2026-09-13',completed:true,deleted_at:null,sync_versions:meta()}]});
  const off=await executeTool(live.db,user,'habit.check',{habitId,date:'2026-09-13',completed:false},{today:'2026-09-13'});
  assert.equal(off.completed,false);
  assert.ok(live.tables.habit_entries[0].deleted_at);
  assert.equal(live.tables.habit_entries[0].sync_versions.life.deleted,true);

  const back=await executeTool(live.db,user,'habit.check',{habitId,date:'2026-09-13',completed:true},{today:'2026-09-13'});
  assert.equal(back.completed,true);
  assert.equal(live.tables.habit_entries[0].deleted_at,null);
  assert.equal(live.tables.habit_entries[0].sync_versions.life.deleted,false);
  assert.equal(live.tables.habit_entries[0].sync_versions.life.generation,1);
});

test('habit delete stays preview-only until confirmation',async()=>{
  const h=database({habits:[{id:habitId,user_id:user,title:'ПДД',deleted_at:null,sync_versions:meta()}]});
  const preview=await executeTool(h.db,user,'habit.delete',{habitId},{today:'2026-09-13'});
  assert.equal(preview.preview.title,'ПДД');
  assert.equal(h.calls.filter(call=>call.mode==='update').length,0);
  await executeTool(h.db,user,'habit.delete',{habitId},{today:'2026-09-13',confirmed:true});
  assert.ok(h.tables.habits[0].deleted_at);
});

test('current-tab AI history is bounded, account-scoped, and uses the existing server contract',()=>{
  assert.match(client,/const conversation = \[\]/);
  assert.match(client,/const MAX_HISTORY = 6/);
  assert.match(client,/while\(conversation\.length>MAX_HISTORY\)conversation\.shift\(\)/);
  assert.match(client,/conversation\.length=0/);
  assert.match(client,/history=historySnapshot\(\)/);
  assert.match(client,/history,memoryEnabled/);
  assert.match(client,/rememberConversation\('user',message\)/);
  assert.match(client,/rememberConversation\('assistant',finalText\)/);
  assert.doesNotMatch(client,/localStorage\.setItem\([^\n]*conversation/);
  assert.match(handler,/history\.length>6/);
  assert.match(handler,/history:safeHistory/);
  assert.match(provider,/previousMessages:input\.history\|\|\[\]/);
});

test('habit mutations pull cloud state and v100 AI ships in the guarded PWA cache',()=>{
  assert.match(client,/\^\(task\|note\|plan\|habit\)/);
  assert.match(client,/window\.SeverCloud\.pull\(\)/);
  assert.match(sw,/v100 refreshes Sever AI/);
  assert.ok(sw.includes("'./js/sever-ai.js?v=100'"));
  assert.equal(resultMessage('habit.create',{}),'Привычка добавлена.');
  assert.match(resultMessage('habit.list',{date:'2026-09-13',habits:[{title:'ПДД',completed:true}]}),/✓ ПДД/);
});
