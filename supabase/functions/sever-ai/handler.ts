import { AiError, fail, object, text, uuid, day, checked } from './validation.ts';
import { toolsFor, SEVER_MANIFEST } from './manifest.ts';
import { systemPrompt, PROMPT_VERSION } from './prompt.ts';
import { providerFromEnv, providerConfig } from './provider.ts';
import { executeTool, owned, needsConfirmation } from './tools.ts';
import { signAction, verifyAction } from './confirmation.ts';

// Only this module coordinates auth, the provider and application actions.
// The admin client is restricted to technical usage records, never user content.
export function createHandler({createClient,env,providerFactory=providerFromEnv}:any) {
  const origins=(env('APP_ORIGINS')||env('APP_ORIGIN')||'https://golovalisaia-hub.github.io').split(',').map((s:string)=>s.trim());
  return async (req:Request):Promise<Response> => {
    const origin=req.headers.get('origin');
    const headers:any={'Vary':'Origin','Cache-Control':'no-store','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PATCH, DELETE, OPTIONS'};
    if(origin&&origins.includes(origin))headers['Access-Control-Allow-Origin']=origin;
    const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
    const errorBody=(error:any)=>({error:error instanceof AiError?error.code:'AI_ERROR',message:error instanceof AiError?error.message:'Не удалось выполнить запрос. Проверьте состояние приложения перед повтором.'});
    let db:any,admin:any,userId='',requestId='',claimed=false,tool:string|null=null,usage:any={};
    const started=Date.now();
    const record=async(success:boolean,error_code:string|null=null)=>{
      if(!claimed||!admin)return;
      try {await admin.from('ai_usage').update({latency_ms:Date.now()-started,input_tokens:Math.max(0,Math.trunc(usage.prompt_tokens||0)),output_tokens:Math.max(0,Math.trunc(usage.completion_tokens||0)),tool,success,error_code}).eq('request_id',requestId).eq('user_id',userId);}catch{/* Technical logging must not repeat or undo a completed action. */}
    };
    try {
      if(origin&&!origins.includes(origin))fail('ORIGIN_DENIED','Источник запроса не разрешён.',403);
      if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(!['GET','POST','PATCH','DELETE'].includes(req.method))fail('METHOD_NOT_ALLOWED','Метод не поддерживается.',405);
      const auth=req.headers.get('authorization')||'';
      if(!/^Bearer \S+$/i.test(auth))fail('AUTH_REQUIRED','Войдите в аккаунт, чтобы использовать Sever AI.',401);
      db=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
      const authResult=await db.auth.getUser();
      if(authResult.error||!authResult.data?.user)fail('AUTH_REQUIRED','Сессия истекла. Войдите снова.',401);
      userId=uuid(authResult.data.user.id);
      const profile=checked(await db.from('profiles').select('role').eq('id',userId).single());
      if(!profile||!['owner','user'].includes(profile.role))fail('PROFILE_UNAVAILABLE','Профиль ещё не готов. Повторите позже.',503);
      const role=profile.role;
      if(req.method==='GET') {
        const memories=checked(await db.from('ai_memories').select('id,content,enabled,updated_at').eq('user_id',userId).order('updated_at',{ascending:false}).limit(100));
        const plans=checked(await db.from('ai_plans').select('id,title,kind,data,status,updated_at').eq('user_id',userId).is('deleted_at',null).order('updated_at',{ascending:false}).limit(100));
        return json({role,memories,plans,promptVersion:PROMPT_VERSION,configured:Boolean(providerConfig(env).key)});
      }
      if(req.method==='DELETE') {
        const id=uuid(new URL(req.url).searchParams.get('id'));
        const rows=checked(await db.from('ai_memories').delete().eq('id',id).eq('user_id',userId).select('id'));
        if(!rows.length)fail('NOT_FOUND','Запись не найдена.',404);
        return json({ok:true});
      }
      if(Number(req.headers.get('content-length')||0)>24000)fail('TOO_LARGE','Слишком большой запрос.',413);
      const reader=req.body?.getReader();let bytes=0,raw='';const decoder=new TextDecoder();
      if(reader){try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>24000)fail('TOO_LARGE','Слишком большой запрос.',413);raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}}
      let body:any;try{body=JSON.parse(raw);}catch{fail('VALIDATION','Некорректный JSON.');}object(body);
      if(req.method==='PATCH') {
        const patch:any={updated_at:new Date().toISOString()};
        if(body.content!==undefined)patch.content=text(body.content,300);
        if(body.enabled!==undefined){if(typeof body.enabled!=='boolean')fail('VALIDATION','Нужен переключатель памяти.');patch.enabled=body.enabled;}
        const result=checked(await db.from('ai_memories').update(patch).eq('id',uuid(body.id)).eq('user_id',userId).select('id,content,enabled,updated_at').maybeSingle());
        if(!result)fail('NOT_FOUND','Запись не найдена.',404);return json({memory:result});
      }
      requestId=uuid(body.requestId);
      const cfg=providerConfig(env);
      const adminKey=env('SUPABASE_SERVICE_ROLE_KEY');
      if(adminKey)admin=createClient(env('SUPABASE_URL'),adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
      const contextRaw=object(body.context||{}),page=contextRaw.currentPage||'today';
      if(!Object.hasOwn(SEVER_MANIFEST.pages,page))fail('VALIDATION','Неизвестный раздел.');
      const timezone=text(contextRaw.timezone||'Europe/Moscow',80);let today:string;
      try{today=new Intl.DateTimeFormat('sv-SE',{timeZone:timezone}).format(new Date());}catch{fail('VALIDATION','Некорректный часовой пояс.');}
      const context:any={page,timezone,today};
      if(contextRaw.selectedDate)context.selectedDate=day(contextRaw.selectedDate);
      for(const [field,table] of [['selectedTaskId','tasks'],['selectedNoteId','notes'],['selectedGoalId','ai_plans'],['activeTimerId','tasks']]) {
        if(contextRaw[field]){await owned(db,table,contextRaw[field],userId);context[field]=uuid(contextRaw[field]);}
      }
      const options:any={role,today,memoryEnabled:body.memoryEnabled===true,admin,provider:cfg.name,model:cfg.model,configured:Boolean(cfg.key)};
      // Signed actions are independent of the LLM and cannot be edited by the client.
      if(body.confirmationToken) {
        const action=await verifyAction(body.confirmationToken,userId,env('AI_CONFIRMATION_SECRET')||'');
        if(!needsConfirmation(action.name))fail('TOOL_DENIED','Действие не поддерживает подтверждение.',403);
        req.signal.throwIfAborted();
        const result=await executeTool(db,userId,action.name,action.arguments,{...options,confirmed:true,actionId:action.id,today:action.today});
        return json({requestId,role,tool:action.name,result,message:resultMessage(action.name,result)});
      }
      const message=text(body.message,2000);
      const history=body.history===undefined?[]:body.history;
      if(!Array.isArray(history)||history.length>6)fail('VALIDATION','Слишком длинная история.');
      const safeHistory=history.map((entry:any)=>{if(!entry||!['user','assistant'].includes(entry.role))fail('VALIDATION','Некорректная история.');return {role:entry.role,content:text(entry.content,2000)};});
      // Existing private notes and memories are NOT silently exported to a provider.
      const configured=providerFactory(env),allowed=toolsFor(page,role,message);
      const quota=await db.rpc('sever_claim_ai_quota',{p_request_id:requestId,p_provider:cfg.name,p_model:cfg.model});
      if(quota.error?.code==='23505')fail('ALREADY_ATTEMPTED','Запрос уже отправлен. Проверьте результат перед повтором.',409);
      if(!checked(quota))fail('RATE_LIMIT','Лимит запросов исчерпан. Попробуйте позже.',429);
      claimed=true;
      const run=async(onText?:(value:string)=>void)=>{
        const response=await configured.provider.complete({system:systemPrompt(role,allowed),message,context,history:safeHistory,signal:req.signal,onText});
        usage=response.usage||{};const reply=response.reply;let result:any=null,pendingAction:any=null;
        if(reply.toolCall) {
          tool=reply.toolCall.name;
          if(!allowed.includes(tool!))fail('TOOL_DENIED','Это действие недоступно.',403);
          req.signal.throwIfAborted();
          result=await executeTool(db,userId,tool!,reply.toolCall.arguments,options);
          if(needsConfirmation(tool!)) {
            pendingAction=await signAction({name:tool,arguments:reply.toolCall.arguments,today,preview:result.preview},userId,env('AI_CONFIRMATION_SECRET')||'');
            result=null;
          }
        }
        await record(true);
        return {requestId,role,tool,result,pendingAction,message:pendingAction?'Проверьте действие и подтвердите его.':tool?resultMessage(tool,result):reply.message};
      };
      if(!req.headers.get('accept')?.includes('text/event-stream'))return json(await run());
      const encoder=new TextEncoder();let connected=true;
      const stream=new ReadableStream({
        start(controller){
          const emit=(event:string,data:any)=>{if(connected){try{controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));}catch{connected=false;}}};
          void (async()=>{try{emit('final',await run(value=>emit('delta',{text:value})));}catch(error){const details=errorBody(error);await record(false,details.error);emit('error',details);}finally{if(connected)controller.close();}})();
        },cancel(){connected=false;}
      });
      return new Response(stream,{headers:{...headers,'Content-Type':'text/event-stream; charset=utf-8','X-Accel-Buffering':'no'}});
    } catch(error) {
      const details=errorBody(error);await record(false,details.error);
      return json({...details,requestId:requestId||undefined},error instanceof AiError?error.status:503);
    }
  };
}

export function resultMessage(tool:string,result:any):string {
  const messages:Record<string,string>={'task.create':'Задача добавлена.','task.update':'Задача изменена.','task.move':'Задача перенесена.','task.complete':'Задача выполнена.','task.delete':'Задача удалена.','note.create':'Заметка создана.','note.update':'Заметка изменена.','note.delete':'Заметка удалена.','plan.create':'План и задачи созданы.','memory.remember':'Сохранено в памяти.','navigation.open':'Открываю раздел.','guide.highlight':'Показываю нужный элемент.','timer.start':'Запускаю таймер на этом устройстве.','timer.stop':'Останавливаю таймер на этом устройстве.','timer.get':'Состояние таймера на этом устройстве:'};
  if(messages[tool])return messages[tool];
  if(tool==='calendar.get')return result.tasks.length?result.tasks.map((t:any)=>`${t.completed?'✓':'○'} ${t.scheduled_for}${t.scheduled_time?' '+t.scheduled_time.slice(0,5):''} — ${t.title}`).join('\n'):'В этом периоде задач нет.';
  if(tool==='progress.get')return `Выполнено ${result.completed} из ${result.total} задач (${result.percent}%).`;
  if(tool==='task.get')return `${result.title} · ${result.scheduled_for}${result.scheduled_time?' '+result.scheduled_time.slice(0,5):''}`;
  if(tool==='note.get')return `${result.title}\n${result.body||''}`;
  return JSON.stringify(result,null,2);
}
