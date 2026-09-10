export const CLOUD_TABLES = Object.freeze({tasks:'tasks',habits:'habits',habitEntries:'habit_entries',notes:'notes',folders:'note_folders',focusSessions:'focus_sessions',settings:'user_settings'});
export const CLOUD_SYNC_ORDER = Object.freeze(['tasks','habits','habitEntries','folders','notes','focusSessions','settings']);
const list=value=>Array.isArray(value)?value:[];
const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const copy=value=>JSON.parse(JSON.stringify(value));
const time=value=>{if(typeof value==='number'&&Number.isFinite(value))return value;const parsed=Date.parse(value||'');return Number.isFinite(parsed)?parsed:0};
const iso=value=>new Date(Math.max(0,time(value)||Date.now())).toISOString();
const localTime=value=>time(value)||Date.now();
export const stableStringify=value=>Array.isArray(value)?`[${value.map(stableStringify).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`:JSON.stringify(value);
export const hasPlannerData=state=>['tasks','notes','habits','folders','focusSessions'].some(key=>list(state?.[key]).length>0);
export const settingsFor=state=>({challengeStart:state.challengeStart||'',challengeDays:Number(state.challengeDays)||0,challengeName:state.challengeName||'',onboarded:Boolean(state.onboarded),tourSeen:Boolean(state.tourSeen),taskMemory:list(state.taskMemory),reminders:obj(state.reminders),profile:obj(state.profile),appearance:obj(state.appearance),stats:obj(state.stats),security:obj(state.security),aiSettings:obj(state.aiSettings)});
export const protectedNoteInvariant=note=>!note?.protected||(note.title===''&&note.body===''&&Array.isArray(note.items)&&note.items.length===0&&note.kind==='protected'&&note.secure&&typeof note.secure==='object');
// Projection must not invent edit times; prepareState stamps actual mutations.
const snapshotTime=value=>new Date(Math.max(0,time(value))).toISOString();
const itemTime=(item,state)=>snapshotTime(item?.updatedAt||item?.createdAt||state?._savedAt);
// A register is one independent field, or an invariant-preserving atomic group.
// Never merge a protected envelope with plaintext from another revision.
export const FIELD_GROUPS = Object.freeze({
  tasks: { title:['title'], date:['date'], time:['time'], duration:['duration'], category:['category'], priority:['priority'], challenge:['challenge'], completion:['completed','completedAt'] },
  habits: { title:['title'] },
  habitEntries: { completion:['completed'] },
  folders: { name:['name'] },
  notes: { folder:['folderId'], content:['title','body','kind','items','done','protected','secure'] },
  focusSessions: { session:['taskId','durationMinutes','startedAt','completedAt','status'] },
  settings: { data:['data'] }
});
const deviceActor = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
const compareStamp = (a,b) => (Number(a?.[0])||0)-(Number(b?.[0])||0) || (String(a?.[1]||'') < String(b?.[1]||'') ? -1 : String(a?.[1]||'') > String(b?.[1]||'') ? 1 : 0);
const groupValue = (row, fields) => fields.map(field => row?.[field] ?? null);
function versions(collection, row) {
  if (row?.syncVersions?.v === 1) return copy(row.syncVersions);
  const stamp = [time(row?.updatedAt), ''];
  return { v:1, life:{ generation:0, deleted:Boolean(row?.deletedAt), stamp }, fields:Object.fromEntries(Object.keys(FIELD_GROUPS[collection]).map(key=>[key,stamp])) };
}
function maxClock(meta) { return Math.max(Number(meta.life.stamp[0])||0, ...Object.values(meta.fields).map(s=>Number(s[0])||0)); }
export function mergeRecord(collection, left, right) {
  if (!left || !right) return copy(left || right);
  if(!left.syncVersions && !right.syncVersions)return copy(time(right.deletedAt||right.updatedAt)>=time(left.deletedAt||left.updatedAt)?right:left);
  // An old full snapshot has no causal information about individual fields.
  // It may be read as legacy data, but cannot supersede a managed record.
  if(!left.syncVersions)return copy(right);
  if(!right.syncVersions)return copy(left);
  const l=versions(collection,left), r=versions(collection,right);
  const lifeOrder=l.life.generation-r.life.generation || Number(l.life.deleted)-Number(r.life.deleted);
  // Delete wins over ALL edits in its generation, even edits with a later clock.
  // Only an explicit Undo that observed the tombstone opens a new generation.
  if (lifeOrder) return copy(lifeOrder>0 ? left : right);
  const life=compareStamp(l.life.stamp,r.life.stamp)>=0 ? l.life : r.life;
  const result={...copy(left),syncVersions:{v:1,life:copy(life),fields:{}}};
  for (const [key,fields] of Object.entries(FIELD_GROUPS[collection])) {
    const a=l.fields[key] || [0,''], b=r.fields[key] || [0,''];
    const order=compareStamp(a,b);
    const winner=order ? (order>0?left:right) : stableStringify(groupValue(left,fields))>=stableStringify(groupValue(right,fields))?left:right;
    for (const field of fields) result[field]=copy(winner[field]??null);
    result.syncVersions.fields[key]=copy(winner===left?a:b);
  }
  result.updatedAt=snapshotTime(Math.max(time(left.updatedAt),time(right.updatedAt)));
  result.createdAt=left.createdAt && right.createdAt ? Math.min(time(left.createdAt),time(right.createdAt)) : left.createdAt || right.createdAt;
  if (life.deleted) result.deletedAt=snapshotTime(life.stamp[0]); else delete result.deletedAt;
  return result;
}
export function collectionsFor(state) {
  const result=legacyCollectionsFor(state);
  for(const [collection,records] of Object.entries(result))for(const [id,row] of records) {
    const meta=state?.syncMeta?.fieldVersions?.[`${collection}:${id}`];
    if(meta?.v===1)row.syncVersions=copy(meta);
  }
  return result;
}
export function prepareState(state, previous=null, now=Date.now(), actor=deviceActor) {
  const before=previous||collectionsFor(state);
  // Preserve local metadata, NOT the last downloaded baseline, while stamping edits.
  const raw=legacyCollectionsFor({...state,syncMeta:{...state.syncMeta,tombstones:{}}});
  const oldMeta=copy(obj(state.syncMeta?.fieldVersions));
  legacyPrepareState(state,previous,now);
  state.syncMeta.fieldVersions=oldMeta;
  const result=legacyCollectionsFor(state);
  for(const [collection,records] of Object.entries(result))for(const [id,row] of records) {
    const old=before[collection]?.get(id), key=`${collection}:${id}`;
    const meta=oldMeta[key] || versions(collection,old || row);
    const live=raw[collection]?.get(id);
    const restored=Boolean(live && (old?.deletedAt || meta.life.deleted) && !state.syncMeta.tombstones[key]);
    const deleted=Boolean(row.deletedAt);
    const changed=Object.entries(FIELD_GROUPS[collection]).filter(([field,fields])=>
      (!old || stableStringify(groupValue(old,fields))!==stableStringify(groupValue(row,fields))) &&
      (!old || compareStamp(meta.fields[field],versions(collection,old).fields[field])<=0));
    if(!oldMeta[key] && !old?.syncVersions && !changed.length && !restored && deleted===meta.life.deleted)continue;
    if(changed.length || deleted!==meta.life.deleted || restored) {
      const stamp=[Math.max(now,maxClock(meta)+1,old?maxClock(versions(collection,old))+1:0),actor];
      if(restored){meta.life={generation:meta.life.generation+1,deleted:false,stamp};delete row.deletedAt;}
      else if(deleted&&!meta.life.deleted)meta.life={...meta.life,deleted:true,stamp};
      for(const [field] of changed)meta.fields[field]=stamp;
      row.updatedAt=snapshotTime(stamp[0]);
      const item=state[collection]?.find?.(x=>x.id===id);
      if(item)item.updatedAt=stamp[0];
      if(collection==='habitEntries')state.syncMeta.habitEntryUpdatedAt[id]=stamp[0];
      if(collection==='settings')state.syncMeta.settingsUpdatedAt=stamp[0];
      if(deleted)state.syncMeta.tombstones[key]={...row,deletedAt:snapshotTime(meta.life.stamp[0])};
    } else if(oldMeta[key]) {
      // legacyPrepareState compares against the server baseline. A field winner
      // already merged locally is NOT a user edit and must retain its clock.
      const clock=maxClock(meta);
      const item=state[collection]?.find?.(x=>x.id===id);
      if(item)item.updatedAt=clock;
      if(collection==='habitEntries')state.syncMeta.habitEntryUpdatedAt[id]=clock;
      if(collection==='settings')state.syncMeta.settingsUpdatedAt=clock;
    }
    state.syncMeta.fieldVersions[key]=copy(meta);
  }
  return collectionsFor(state);
}
function legacyCollectionsFor(state){const safe=obj(state),entryTimes=obj(safe.syncMeta?.habitEntryUpdatedAt),tombstones=obj(safe.syncMeta?.tombstones),out={tasks:new Map(),habits:new Map(),habitEntries:new Map(),notes:new Map(),folders:new Map(),focusSessions:new Map(),settings:new Map()};list(safe.tasks).forEach(task=>out.tasks.set(task.id,{id:task.id,title:task.title||'',date:task.date||null,time:task.time||null,duration:task.duration??null,category:task.category||'Личное',priority:Boolean(task.priority),challenge:Boolean(task.challenge),completed:Boolean(task.completed),completedAt:task.completedAt||null,createdAt:task.createdAt||null,updatedAt:itemTime(task,safe)}));list(safe.habits).forEach(habit=>out.habits.set(habit.id,{id:habit.id,title:habit.title||'',createdAt:habit.createdAt||null,updatedAt:itemTime(habit,safe)}));Object.entries(obj(safe.checks)).forEach(([habitId,dates])=>list(dates).forEach(date=>{const id=`${habitId}:${date}`;out.habitEntries.set(id,{id,habitId,date,completed:true,updatedAt:snapshotTime(entryTimes[id]||safe._savedAt)})}));list(safe.notes).forEach(note=>{if(!protectedNoteInvariant(note))throw new Error('Protected note invariant failed');out.notes.set(note.id,{id:note.id,folderId:note.folderId||'',title:note.protected?'':note.title||'',body:note.protected?'':note.body||'',kind:note.protected?'protected':note.kind||'text',items:note.protected?[]:list(note.items),done:Boolean(note.done),protected:Boolean(note.protected),secure:note.protected?obj(note.secure):null,createdAt:note.createdAt||null,updatedAt:itemTime(note,safe)});});list(safe.folders).forEach(folder=>out.folders.set(folder.id,{id:folder.id,name:folder.name||'',createdAt:folder.createdAt||null,updatedAt:itemTime(folder,safe)}));list(safe.focusSessions).forEach(session=>out.focusSessions.set(session.id,{id:session.id,taskId:session.taskId||null,durationMinutes:Number(session.durationMinutes)||0,startedAt:session.startedAt||null,completedAt:session.completedAt||null,status:session.status||'completed',createdAt:session.createdAt||null,updatedAt:itemTime(session,safe)}));out.settings.set('settings',{id:'settings',data:settingsFor(safe),updatedAt:snapshotTime(safe.syncMeta?.settingsUpdatedAt||safe._savedAt)});Object.values(tombstones).forEach(record=>{if(!record?.collection||!out[record.collection]||!record.id)return;const active=out[record.collection].get(record.id);if(!active||time(record.deletedAt||record.updatedAt)>=time(active.updatedAt))out[record.collection].set(record.id,record)});Object.values(out).forEach(records=>records.forEach((record,id)=>records.set(id,copy(record))));return out}
const fingerprint=record=>{const next={...record};delete next.createdAt;delete next.updatedAt;delete next.syncVersions;return stableStringify(next)};
const mapSnapshot=map=>[...map.entries()].sort(([left],[right])=>String(left).localeCompare(String(right))).map(([id,record])=>[id,fingerprint(record)]);
export function changedCollections(beforeState,afterState){const before=collectionsFor(beforeState),after=collectionsFor(afterState);return Object.keys(CLOUD_TABLES).filter(collection=>stableStringify(mapSnapshot(before[collection]))!==stableStringify(mapSnapshot(after[collection])))}
export function changedRecordIds(beforeState,afterState,collections=changedCollections(beforeState,afterState)){const before=collectionsFor(beforeState),after=collectionsFor(afterState),result={};collections.forEach(collection=>{const ids=new Set([...before[collection].keys(),...after[collection].keys()]);result[collection]=[...ids].filter(id=>fingerprint(before[collection].get(id)??{})!==fingerprint(after[collection].get(id)??{}))});return result}
function legacyPrepareState(state,previous=null,now=Date.now()){state.syncMeta=obj(state.syncMeta);state.syncMeta.habitEntryUpdatedAt=obj(state.syncMeta.habitEntryUpdatedAt);state.syncMeta.tombstones=obj(state.syncMeta.tombstones);state.syncMeta.seededAt||=now;const old=previous||collectionsFor(state),projected=collectionsFor(state),touch=(key,items)=>list(items).forEach(item=>{if(!item?.id)return;item.createdAt||=now;const earlier=old[key]?.get(item.id);if(!item.updatedAt||!earlier||fingerprint(earlier)!==fingerprint(projected[key].get(item.id)))item.updatedAt=now});touch('tasks',state.tasks);touch('habits',state.habits);touch('notes',state.notes);touch('folders',state.folders);touch('focusSessions',state.focusSessions);const raw=collectionsFor({...state,syncMeta:{...state.syncMeta,tombstones:{}}});Object.keys(CLOUD_TABLES).filter(collection=>collection!=='settings').forEach(collection=>old[collection]?.forEach((record,id)=>{if(!record.deletedAt&&!raw[collection].has(id))state.syncMeta.tombstones[`${collection}:${id}`]={...record,collection,id,deletedAt:iso(now),updatedAt:iso(now)}}));const next=collectionsFor(state);next.habitEntries.forEach((entry,id)=>{if(!state.syncMeta.habitEntryUpdatedAt[id]||(old.habitEntries?.has(id)&&fingerprint(old.habitEntries.get(id))!==fingerprint(entry)))state.syncMeta.habitEntryUpdatedAt[id]=now});if(!state.syncMeta.settingsUpdatedAt||(old.settings?.get('settings')&&fingerprint(old.settings.get('settings'))!==fingerprint(next.settings.get('settings'))))state.syncMeta.settingsUpdatedAt=now;return collectionsFor(state)}
export function diffCollections(before,after,now=Date.now()){
  const result=[];
  Object.keys(CLOUD_TABLES).forEach(collection=>{
    const old=before?.[collection]||new Map(),next=after?.[collection]||new Map();
    next.forEach((record,id)=>{
      const signature=value=>{const r={...value};delete r.createdAt;if(r.syncVersions?.v===1)delete r.updatedAt;return stableStringify(r);};
      if(!old.has(id)||signature(old.get(id))!==signature(record))result.push({type:'upsert',collection,id,record});
    });
    old.forEach((record,id)=>{
      if(!next.has(id)){
        const meta=versions(collection,record),clock=Math.max(now,maxClock(meta)+1);
        meta.life={...meta.life,deleted:true,stamp:[clock,deviceActor]};
        result.push({type:'delete',collection,id,record:{...record,deletedAt:iso(clock),updatedAt:iso(clock),syncVersions:meta}});
      }
    });
  });
  return result;
}
export const queueLatest=operations=>[...operations.reduce((map,operation)=>{if(operation?.collection==='notes'&&!protectedNoteInvariant(operation.record))throw new Error('Protected note sync blocked');map.set(`${operation.collection}:${operation.id}`,operation);return map},new Map()).values()];
export const sortCloudOperations=operations=>[...operations].sort((left,right)=>CLOUD_SYNC_ORDER.indexOf(left.collection)-CLOUD_SYNC_ORDER.indexOf(right.collection));
export async function settleCloudOperations(operations,writeOperation){const succeeded=[],failed=[];for(const operation of sortCloudOperations(operations)){try{await writeOperation(operation);succeeded.push(operation)}catch(error){failed.push({operation,error})}}return{succeeded,failed}}

function stateFromCollections(template,collections){
  const next=copy(template),active=key=>[...collections[key].values()].filter(record=>!record.deletedAt),asLocal=value=>localTime(value);
  next.tasks=active('tasks').map(row=>({id:row.id,title:row.title,date:row.date||'',time:row.time||'',duration:row.duration??null,category:row.category,priority:row.priority,challenge:row.challenge,completed:row.completed,completedAt:row.completedAt?asLocal(row.completedAt):null,createdAt:asLocal(row.createdAt),updatedAt:asLocal(row.updatedAt)}));
  next.habits=active('habits').map(row=>({id:row.id,title:row.title,createdAt:asLocal(row.createdAt),updatedAt:asLocal(row.updatedAt)}));
  next.syncMeta=obj(next.syncMeta);
  next.syncMeta.fieldVersions={};
  for(const [collection,records] of Object.entries(collections))for(const [id,row] of records)if(row.syncVersions)next.syncMeta.fieldVersions[collection+':'+id]=copy(row.syncVersions);
  const activeHabitIds=new Set(active('habits').map(row=>row.id));
  next.syncMeta.habitEntryUpdatedAt={};
  next.checks={};
  active('habitEntries').filter(row=>row.completed&&activeHabitIds.has(row.habitId)).forEach(row=>{(next.checks[row.habitId]||=[]).push(row.date);next.syncMeta.habitEntryUpdatedAt[row.id]=asLocal(row.updatedAt)});
  next.notes=active('notes').map(row=>({id:row.id,folderId:row.folderId||'',title:row.protected?'':row.title,body:row.protected?'':row.body,kind:row.kind,items:row.protected?[]:list(row.items),done:Boolean(row.done),protected:Boolean(row.protected),...(row.protected?{secure:row.secure}:{}),createdAt:asLocal(row.createdAt),updatedAt:asLocal(row.updatedAt)}));
  next.folders=active('folders').map(row=>({id:row.id,name:row.name,createdAt:asLocal(row.createdAt),updatedAt:asLocal(row.updatedAt)}));
  next.focusSessions=active('focusSessions').map(row=>({id:row.id,taskId:row.taskId,durationMinutes:row.durationMinutes,startedAt:row.startedAt?asLocal(row.startedAt):null,completedAt:row.completedAt?asLocal(row.completedAt):null,status:row.status,createdAt:asLocal(row.createdAt),updatedAt:asLocal(row.updatedAt)}));
  const settingsRecord=collections.settings.get('settings');
  if(settingsRecord?.data)Object.assign(next,copy(settingsRecord.data));
  if(settingsRecord?.updatedAt)next.syncMeta.settingsUpdatedAt=asLocal(settingsRecord.updatedAt);
  next.syncMeta.tombstones={};
  Object.keys(CLOUD_TABLES).forEach(collection=>collections[collection].forEach((record,id)=>{if(record.deletedAt&&collection!=='settings')next.syncMeta.tombstones[collection+':'+id]={...record,collection}}));
  return next
}
export function mergeStates(local,remote){const left=collectionsFor(local),right=collectionsFor(remote),merged={};Object.keys(CLOUD_TABLES).forEach(key=>{merged[key]=new Map();new Set([...left[key].keys(),...right[key].keys()]).forEach(id=>merged[key].set(id,mergeRecord(key,left[key].get(id),right[key].get(id))))});return stateFromCollections(local,merged)}
export function rowsToState(template,rows){const collections={tasks:new Map(),habits:new Map(),habitEntries:new Map(),notes:new Map(),folders:new Map(),focusSessions:new Map(),settings:new Map()};list(rows.tasks).forEach(row=>collections.tasks.set(row.id,{id:row.id,title:row.title,date:row.scheduled_for,time:typeof row.scheduled_time==='string'?row.scheduled_time.slice(0,5):'',duration:row.duration_minutes,category:row.category,priority:row.priority,challenge:row.challenge,completed:row.completed,completedAt:row.completed_at,createdAt:row.created_at,updatedAt:row.updated_at,deletedAt:row.deleted_at}));list(rows.habits).forEach(row=>collections.habits.set(row.id,{id:row.id,title:row.title,createdAt:row.created_at,updatedAt:row.updated_at,deletedAt:row.deleted_at}));list(rows.habitEntries).forEach(row=>collections.habitEntries.set(`${row.habit_id}:${row.entry_date}`,{id:`${row.habit_id}:${row.entry_date}`,habitId:row.habit_id,date:row.entry_date,completed:row.completed,updatedAt:row.updated_at,deletedAt:row.deleted_at}));list(rows.notes).forEach(row=>collections.notes.set(row.id,{id:row.id,folderId:row.folder_id,title:row.title,body:row.body,kind:row.kind,items:row.items,done:row.done,protected:row.protected,secure:row.secure,createdAt:row.created_at,updatedAt:row.updated_at,deletedAt:row.deleted_at}));list(rows.folders).forEach(row=>collections.folders.set(row.id,{id:row.id,name:row.name,createdAt:row.created_at,updatedAt:row.updated_at,deletedAt:row.deleted_at}));list(rows.focusSessions).forEach(row=>collections.focusSessions.set(row.id,{id:row.id,taskId:row.task_id,durationMinutes:row.duration_minutes,startedAt:row.started_at,completedAt:row.completed_at,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,deletedAt:row.deleted_at}));if(list(rows.settings)[0])collections.settings.set('settings',{id:'settings',data:rows.settings[0].data||{},updatedAt:rows.settings[0].updated_at,deletedAt:rows.settings[0].deleted_at});for(const [key,records] of Object.entries(collections)){const source=list(rows[key]);for(const [id,record] of records){const row=source.find(r=>key==='settings'?true:key==='habitEntries'?id===r.habit_id+':'+r.entry_date:id===r.id);if(row?.sync_versions?.v===1)record.syncVersions=copy(row.sync_versions);}}return stateFromCollections(template,collections)}
