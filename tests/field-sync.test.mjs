import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionsFor, prepareState, mergeStates, mergeRecord, diffCollections, rowsToState } from '../js/sync-core.mjs';

const clone=structuredClone;
const initial=()=>({tasks:[{id:'t',title:'Original',category:'Home',date:'2026-09-10',duration:25,createdAt:1000,updatedAt:1000}],notes:[],habits:[],folders:[],focusSessions:[],checks:{},syncMeta:{settingsUpdatedAt:1000,tombstones:{}}});
function edit(state, changes, clock, actor) {
  const before=collectionsFor(state);
  Object.assign(state.tasks[0],changes);
  return prepareState(state,before,clock,actor);
}
function pair(){const s=initial();return[clone(s),clone(s)];}
function merged(a,b){return mergeStates(a,b);}
function remove(s,clock=2000){const before=collectionsFor(s);s.tasks=[];prepareState(s,before,clock,'delete');}
function restore(s,snapshot,clock=4000){
  const before=collectionsFor(s);s.tasks=[{...snapshot,updatedAt:clock}];delete s.syncMeta.tombstones['tasks:t'];
  prepareState(s,before,clock,'undo');
}

test('A: offline title and category merge commutatively',()=>{
  const [a,b]=pair();edit(a,{title:'Новое название'},2000,'A');edit(b,{category:'Работа'},2001,'B');
  for(const s of [merged(a,b),merged(b,a)]){assert.equal(s.tasks[0].title,'Новое название');assert.equal(s.tasks[0].category,'Работа');}
});
test('B: same-field clock then actor deterministic; order-independent',()=>{
  const [a,b]=pair();edit(a,{title:'A'},2000,'A');edit(b,{title:'B'},2000,'B');
  assert.equal(merged(a,b).tasks[0].title,'B');assert.equal(merged(b,a).tasks[0].title,'B');
});
test('C: concurrent delete wins even against a later edit',()=>{
  const [a,b]=pair();edit(a,{title:'Late stale edit'},9000,'A');remove(b,2000);
  assert.equal(merged(a,b).tasks.length,0);assert.equal(merged(b,a).tasks.length,0);
});
test('D: explicit Undo advances generation; stale deletion cannot delete restored record',()=>{
  const [a,b]=pair();const snapshot=clone(a.tasks[0]);remove(a);const deleted=clone(a);
  restore(a,snapshot);for(const remote of [deleted,b])assert.equal(merged(remote,a).tasks.length,1);
  assert.equal(merged(deleted,a).syncMeta.fieldVersions['tasks:t'].life.generation,1);
});
test('E: repeated edits on both offline clients preserve independent fields',()=>{
  const [a,b]=pair();edit(a,{title:'A1'},2000,'A');edit(a,{title:'A2'},2001,'A');
  edit(b,{category:'B1'},2000,'B');edit(b,{category:'B2'},2002,'B');
  const s=merged(a,b);assert.equal(s.tasks[0].title,'A2');assert.equal(s.tasks[0].category,'B2');
});
test('F/G: duplicate delivery and repeated reconciliation are idempotent',()=>{
  const [a,b]=pair();edit(a,{title:'A'},2000,'A');edit(b,{category:'B'},2001,'B');
  const expected=merged(a,b);let s=clone(expected);
  for(let i=0;i<8;i++)s=merged(merged(s,a),b);
  assert.deepEqual(s,expected);
});
test('H: one device, no-op save and old records remain compatible',()=>{
  const s=initial(),before=collectionsFor(s);assert.equal(diffCollections(before,prepareState(s,before,2000,'A')).length,0);
  edit(s,{title:'Changed'},2000,'A');const next=collectionsFor(s);assert.equal(diffCollections(next,prepareState(s,next,3000,'A')).length,0);
});
test('pulled field winners are not restamped as new local edits',()=>{
  const [a,b]=pair();edit(a,{title:'A'},2000,'A');edit(b,{category:'B'},2001,'B');
  const s=merged(a,b),meta=clone(s.syncMeta.fieldVersions['tasks:t']);
  prepareState(s,collectionsFor(b),9000,'A');
  assert.deepEqual(s.syncMeta.fieldVersions['tasks:t'],meta);
});
test('completion state/timestamp and protected note content are atomic groups',()=>{
  const a={id:'n',title:'Plain',body:'Text',items:[],kind:'text',protected:false,secure:null,updatedAt:1000};
  const b={...a,title:'',body:'',items:[],kind:'protected',protected:true,secure:{ciphertext:'opaque'},updatedAt:2000,
    syncVersions:{v:1,life:{generation:0,deleted:false,stamp:[1000,'']},fields:{content:[2000,'B'],folder:[1000,'']}}};
  const r=mergeRecord('notes',a,b);assert.equal(r.protected,true);assert.equal(r.title,'');assert.equal(r.body,'');
});
test('a legacy full snapshot cannot override versioned fields or a tombstone',()=>{
  const [a,b]=pair();edit(a,{title:'Managed'},2000,'A');b.tasks[0].title='Legacy';b.tasks[0].updatedAt=999999;
  assert.equal(merged(a,b).tasks[0].title,'Managed');remove(a,3000);
  assert.equal(merged(b,a).tasks.length,0);
});
test('PostgreSQL time seconds normalize before diff and never create phantom edits',()=>{
  const s=initial();edit(s,{time:'18:30'},2000,'A');const r=collectionsFor(s).tasks.get('t');
  const remote=rowsToState(s,{tasks:[{id:'t',title:r.title,scheduled_for:r.date,scheduled_time:'18:30:00',duration_minutes:r.duration,category:r.category,priority:false,challenge:false,completed:false,created_at:new Date(1000).toISOString(),updated_at:r.updatedAt,sync_versions:r.syncVersions}]});
  assert.equal(remote.tasks[0].time,'18:30');
  assert.deepEqual(remote.syncMeta.fieldVersions['tasks:t'],r.syncVersions);
});
