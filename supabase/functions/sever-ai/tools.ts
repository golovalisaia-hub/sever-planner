import { SEVER_MANIFEST } from './manifest.ts';
import { object,text,day,clock,number,uuid,range,checked,fail,publicRecord } from './validation.ts';
import { calculatePlan } from './plans.ts';
import { versionedPatch } from './sync-versions.ts';
export const needsConfirmation=(name:string)=>['task.delete','note.delete','plan.create','memory.remember'].includes(name);
export async function owned(db:any,table:string,id:string,userId:string) {
  const row=checked(await db.from(table).select('*').eq('id',uuid(id)).eq('user_id',userId).is('deleted_at',null).maybeSingle());
  if(!row)fail('NOT_FOUND','Запись не найдена.',404);
  return row;
}
export async function executeTool(db:any,userId:string,name:string,raw:any,options:any={}) {
  const a=object(raw),now=new Date().toISOString(),role=options.role||'user';
  if(SEVER_MANIFEST.ownerTools.includes(name as any)) {
    if(role!=='owner')fail('TOOL_DENIED','Недостаточно прав.',403);
    if(name==='ai.getStatus')return {provider:options.provider,model:options.model,configured:Boolean(options.configured)};
    if(name==='ai.getUsage')return checked(await options.admin.rpc('sever_ai_system_usage'));
    const started=Date.now();
    checked(await db.from('tasks').select('id').eq('user_id',userId).limit(1));
    return {database:'reachable',latencyMs:Date.now()-started,checkedAt:now,
      ...(name==='system.getStatus'?{pages:SEVER_MANIFEST.pages,aiConfigured:Boolean(options.configured)}:{realtime:'Проверка БД успешна; состояние соединения устройства показано в Настройках.'})};
  }
  if(!SEVER_MANIFEST.userTools.includes(name as any))fail('TOOL_DENIED','Инструмент недоступен.',403);
  if(needsConfirmation(name)&&!options.confirmed) {
    if(name==='plan.create')return {preview:calculatePlan(a,options.today)};
    if(name==='task.delete'||name==='note.delete') {
      const row=await owned(db,name.startsWith('task')?'tasks':'notes',a.taskId||a.noteId,userId);
      if(row.protected)fail('PROTECTED_NOTE','Защищённые заметки доступны только в редакторе.',403);
      return {preview:{title:row.title}};
    }
    if(options.memoryEnabled!==true)fail('MEMORY_DISABLED','Память отключена.',403);
    return {preview:{content:text(a.content,300)}};
  }
  if(name==='navigation.open') {
    if(!(a.page in SEVER_MANIFEST.pages))fail('VALIDATION','Раздел не найден.');
    return {clientAction:{name,arguments:{page:a.page}}};
  }
  if(name==='guide.highlight') {
    if(!SEVER_MANIFEST.guideTargets.includes(a.target))fail('VALIDATION','Элемент гида не найден.');
    return {clientAction:{name,arguments:{target:a.target}}};
  }
  if(name==='timer.start'||name==='timer.stop'||name==='timer.get') {
    if(a.taskId)await owned(db,'tasks',a.taskId,userId);
    const duration=a.durationMinutes===undefined?null:number(a.durationMinutes,1,600,true);
    return {clientAction:{name,arguments:{taskId:a.taskId||null,durationMinutes:duration}}};
  }
  if(name==='task.create') {
    const row={id:options.actionId||crypto.randomUUID(),user_id:userId,title:text(a.title),scheduled_for:day(a.date),
      scheduled_time:a.time===undefined?null:clock(a.time),duration_minutes:a.durationMinutes==null?null:number(a.durationMinutes,1,600,true),
      category:a.category===undefined?'Личное':text(a.category,80),priority:a.priority===true,challenge:false,completed:false,updated_at:now};
    return publicRecord(checked(await db.from('tasks').insert(row).select().single()));
  }
  if(['task.get','task.update','task.move','task.complete','task.delete'].includes(name)) {
    const row=await owned(db,'tasks',a.taskId,userId);
    if(name==='task.get')return publicRecord(row);
    const patch:any={updated_at:now};
    if(name==='task.move')patch.scheduled_for=day(a.date);
    if(name==='task.complete'){patch.completed=true;patch.completed_at=now;}
    if(name==='task.delete')patch.deleted_at=now;
    if(name==='task.update'||name==='task.move') {
      if(a.title!==undefined)patch.title=text(a.title);
      if(a.date!==undefined)patch.scheduled_for=day(a.date);
      if(a.time!==undefined)patch.scheduled_time=clock(a.time);
      if(a.durationMinutes!==undefined)patch.duration_minutes=number(a.durationMinutes,1,600,true);
    }
    let query=db.from('tasks').update(versionedPatch('tasks',row,patch)).eq('id',row.id).eq('user_id',userId).is('deleted_at',null);
    if(row.sync_versions?.v===1)query=query.eq('sync_versions',JSON.stringify(row.sync_versions));
    return publicRecord(checked(await query.select().single()));
  }
  if(name==='calendar.get'||name==='progress.get') {
    const [from,to]=range(a.from||options.today,a.to||a.from||options.today);
    const rows=checked(await db.from('tasks').select('id,title,scheduled_for,scheduled_time,completed,duration_minutes')
      .eq('user_id',userId).is('deleted_at',null).gte('scheduled_for',from).lte('scheduled_for',to).order('scheduled_for').limit(501));
    if(rows.length>500)fail('RANGE_TOO_LARGE','Сократите период: более 500 задач.',422);
    if(name==='calendar.get')return {from,to,tasks:rows};
    const completed=rows.filter((r:any)=>r.completed).length;
    return {from,to,total:rows.length,completed,percent:rows.length?Math.round(100*completed/rows.length):0};
  }
  if(name==='note.create')return publicRecord(checked(await db.from('notes').insert({
    id:crypto.randomUUID(),user_id:userId,title:text(a.title),body:text(a.body||'',8000,true),
    kind:'text',items:[],done:false,protected:false,updated_at:now}).select().single()));
  if(['note.get','note.update','note.delete'].includes(name)) {
    const note=await owned(db,'notes',a.noteId,userId);
    if(note.protected)fail('PROTECTED_NOTE','Защищённые заметки доступны только в редакторе.',403);
    if(name==='note.get')return publicRecord(note);
    const patch:any={updated_at:now};
    if(name==='note.delete')patch.deleted_at=now;
    else {if(a.title!==undefined)patch.title=text(a.title);if(a.body!==undefined)patch.body=text(a.body,8000,true);}
    let query=db.from('notes').update(versionedPatch('notes',note,patch)).eq('id',note.id).eq('user_id',userId).eq('protected',false);
    if(note.sync_versions?.v===1)query=query.eq('sync_versions',JSON.stringify(note.sync_versions));
    return publicRecord(checked(await query.select().single()));
  }
  if(name==='plan.get')return publicRecord(await owned(db,'ai_plans',a.planId,userId));
  if(name==='plan.create') {
    if(a.sourceNoteId)await owned(db,'notes',a.sourceNoteId,userId);
    const built=calculatePlan(a,options.today);built.plan.id=uuid(options.actionId);
    built.plan.data.taskIds=built.tasks.map((task:any)=>{task.id=crypto.randomUUID();return task.id;});
    return publicRecord(checked(await db.rpc('sever_create_ai_plan',{p_plan:built.plan,p_tasks:built.tasks})));
  }
  if(name==='memory.remember') {
    if(options.memoryEnabled!==true)fail('MEMORY_DISABLED','Память отключена.',403);
    return publicRecord(checked(await db.from('ai_memories').upsert({id:uuid(options.actionId),user_id:userId,content:text(a.content,300),enabled:true,updated_at:now},{onConflict:'id'}).select().single()));
  }
}
