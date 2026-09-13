import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

type ReminderKind = 'day_before' | 'fifteen_minutes';
type PushJob = {
  delivery_id:number;
  subscription_id:string;
  endpoint:string;
  p256dh:string;
  auth:string;
  task_id:string;
  user_id:string;
  task_title:string;
  task_category?:string | null;
  task_priority?:boolean | null;
  duration_minutes?:number | null;
  scheduled_for:string;
  scheduled_time:string;
  reminder_kind:ReminderKind;
  due_at:string;
};
type PushGroup = { key:string; jobs:PushJob[] };

type PushPayload = {
  title:string;
  body:string;
  tag:string;
  topic:string;
  url:string;
  taskId?:string;
  reminderKind:ReminderKind;
  count?:number;
};

const json = (body:unknown, status=200) => new Response(JSON.stringify(body), {
  status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});

function safeEqual(left:string,right:string){
  const a=new TextEncoder().encode(left), b=new TextEncoder().encode(right);
  if(a.length!==b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i+=1) diff|=a[i]^b[i];
  return diff===0;
}

const timeLabel=(value:string)=>typeof value==='string'?value.slice(0,5):'';
const normalize=(value:unknown)=>String(value||'').trim().replace(/\s+/g,' ');
const clip=(value:string,max=38)=>value.length<=max?value:`${value.slice(0,Math.max(1,max-1)).trimEnd()}…`;

function hash(value:string){
  let out=2166136261;
  for(let i=0;i<value.length;i+=1){out^=value.charCodeAt(i);out=Math.imul(out,16777619);}
  return out>>>0;
}

function stablePick<T>(items:T[],seed:string):T{return items[hash(seed)%items.length];}
function topicFor(seed:string){return `sever-${hash(seed).toString(36)}`.slice(0,32);}
function pluralTasks(count:number){
  const mod10=count%10,mod100=count%100;
  if(mod10===1&&mod100!==11)return `${count} задача`;
  if(mod10>=2&&mod10<=4&&(mod100<12||mod100>14))return `${count} задачи`;
  return `${count} задач`;
}

function taskKind(job:PushJob){
  const hay=`${normalize(job.task_category)} ${normalize(job.task_title)}`.toLowerCase();
  if(/уч[её]б|study|python|пдд|экзам|урок|курс|домашн/.test(hay)) return 'study';
  if(/работ|work|проект|созвон|встреч|отч[её]т|дедлайн|клиент/.test(hay)) return 'work';
  if(/спорт|трен|бег|зал|gym|fitness|workout|йог/.test(hay)) return 'health';
  if(/дом|уборк|магазин|купить|забрать|семь|личн/.test(hay)) return 'personal';
  return 'general';
}

function durationHint(job:PushJob,soon:boolean){
  const minutes=Number(job.duration_minutes||0);
  if(minutes<60) return '';
  if(soon) return minutes>=120?'Освободи пространство для длинного фокуса.':'Подготовь всё для спокойного часа фокуса.';
  return minutes>=120?'Заложи под это отдельный блок времени.':'Лучше заранее оставить под это полноценный час.';
}

function copyFor(job:PushJob){
  const soon=job.reminder_kind==='fifteen_minutes';
  const kind=taskKind(job);
  const priority=job.task_priority===true;
  const seed=`${job.task_id}:${job.reminder_kind}:${job.scheduled_for}`;
  const duration=durationHint(job,soon);

  const soonCopy:Record<string,string[]>={
    study:[
      'Открой материалы и начни с первого понятного шага.',
      'Подготовь всё нужное — дальше просто начни.',
      'Без разгона: один маленький шаг, и ты уже в деле.'
    ],
    work:[
      'Закрой лишнее и спокойно переключись на эту задачу.',
      'Освободи фокус — скоро можно начинать.',
      'Собери внимание в одну точку и начни с главного.'
    ],
    health:[
      'Подготовься без спешки — скоро просто старт.',
      'Собери всё нужное и начни в своём темпе.',
      'Никакого рывка: подготовься и просто начни.'
    ],
    personal:[
      'Проверь, всё ли под рукой, и начни спокойно.',
      'Ещё немного — и можно закрыть это дело.',
      'Один спокойный шаг сейчас упростит остальное.'
    ],
    general:[
      'Один спокойный шаг — и ты уже в процессе.',
      'Скоро старт. Подготовь всё нужное без спешки.',
      'Не нужно делать всё сразу — просто начни.'
    ]
  };

  const tomorrowCopy:Record<string,string[]>={
    study:[
      'Подготовь материалы заранее — завтра начать будет легче.',
      'Небольшая подготовка сегодня снимет суету завтра.',
      'Пусть всё нужное будет под рукой — завтра останется начать.'
    ],
    work:[
      'Оставь под это время заранее — завтра будет проще держать фокус.',
      'Лучше освободить место в расписании до того, как день заполнится.',
      'Небольшая подготовка сегодня сделает завтра спокойнее.'
    ],
    health:[
      'Подготовь всё заранее — завтра останется просто начать.',
      'Оставь для этого место в дне, без гонки и перегруза.',
      'Сегодня достаточно подготовиться, завтра — спокойно сделать.'
    ],
    personal:[
      'Лучше подготовить мелочи заранее — завтра будет спокойнее.',
      'Оставь для этого немного места в завтрашнем дне.',
      'Пусть задача не потеряется среди остальных дел.'
    ],
    general:[
      'Оставь для этого немного места в завтрашнем дне.',
      'Небольшая подготовка заранее — и завтра проще.',
      'Пусть это не потеряется среди остальных дел.'
    ]
  };

  if(duration) return duration;
  if(priority) return soon
    ? stablePick(['Это важное. Закрой лишнее и начни с первого шага.','Это важное. Спокойно переключись на него сейчас.'],seed)
    : stablePick(['Это важное. Лучше заранее освободить под него время.','Это важное. Оставь ему место в завтрашнем дне.'],seed);
  return stablePick((soon?soonCopy:tomorrowCopy)[kind],seed);
}

function groupJobs(jobs:PushJob[]):PushGroup[]{
  const groups=new Map<string,PushJob[]>();
  for(const job of jobs){
    const dueMinute=String(job.due_at||'').slice(0,16);
    const key=`${job.subscription_id}:${job.reminder_kind}:${dueMinute}`;
    const group=groups.get(key)||[];
    group.push(job);
    groups.set(key,group);
  }
  return [...groups.entries()].map(([key,grouped])=>({key,jobs:grouped}));
}

function payloadFor(group:PushGroup):PushPayload{
  const jobs=[...group.jobs].sort((a,b)=>Number(b.task_priority===true)-Number(a.task_priority===true));
  const first=jobs[0];
  const soon=first.reminder_kind==='fifteen_minutes';

  if(jobs.length===1){
    const task=clip(normalize(first.task_title)||'Задача',38);
    const time=timeLabel(first.scheduled_time);
    return {
      title:soon?`Через 15 мин · ${task}`:`Завтра${time?`, ${time}`:''} · ${task}`,
      body:copyFor(first),
      tag:`sever-task-${first.task_id}-${first.reminder_kind}`,
      topic:topicFor(`${first.task_id}:${first.reminder_kind}`),
      url:`./?view=today&task=${encodeURIComponent(first.task_id)}`,
      taskId:first.task_id,
      reminderKind:first.reminder_kind
    };
  }

  const names=jobs.slice(0,2).map(job=>clip(normalize(job.task_title)||'Задача',24)).join(', ');
  const rest=Math.max(0,jobs.length-2);
  const summary=`${names}${rest?` и ещё ${rest}`:''}`;
  return {
    title:soon?`Через 15 мин · ${pluralTasks(jobs.length)}`:`Завтра · ${pluralTasks(jobs.length)}`,
    body:soon?`${summary}. Начни с важного — остальное подождёт.`:`${summary}. Распредели их заранее — завтра будет спокойнее.`,
    tag:`sever-bundle-${first.subscription_id}-${first.reminder_kind}`,
    topic:topicFor(group.key),
    url:'./?view=today',
    reminderKind:first.reminder_kind,
    count:jobs.length
  };
}

export default {
  async fetch(req:Request):Promise<Response>{
    if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);

    const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';
    const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
    if(!supabaseUrl||!serviceRoleKey) return json({error:'SERVER_CONFIG'},503);

    const admin=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const secretsResult=await admin.rpc('sever_push_runtime_secrets').single();
    if(secretsResult.error||!secretsResult.data) return json({error:'PUSH_CONFIG'},503);

    const secrets=secretsResult.data as {vapid_public:string;vapid_private:string;cron_token:string};
    const presented=req.headers.get('x-sever-cron-token')||'';
    if(!presented||!safeEqual(presented,secrets.cron_token||'')) return json({error:'UNAUTHORIZED'},401);
    if(!secrets.vapid_public||!secrets.vapid_private) return json({error:'PUSH_CONFIG'},503);

    webpush.setVapidDetails('https://golovalisaia-hub.github.io/sever-planner/',secrets.vapid_public,secrets.vapid_private);

    const claimed=await admin.rpc('sever_claim_due_pushes_v96',{p_limit:120});
    if(claimed.error) return json({error:'CLAIM_FAILED'},503);

    const jobs=(claimed.data||[]) as PushJob[];
    const groups=groupJobs(jobs);
    let sent=0,failed=0,retired=0;

    for(const group of groups){
      const first=group.jobs[0];
      const payload=payloadFor(group);
      try{
        await webpush.sendNotification(
          {endpoint:first.endpoint,keys:{p256dh:first.p256dh,auth:first.auth}},
          JSON.stringify(payload),
          {
            TTL:first.reminder_kind==='day_before'?43200:1200,
            urgency:first.reminder_kind==='fifteen_minutes'?'high':'normal',
            topic:payload.topic
          }
        );
        const ids=group.jobs.map(job=>job.delivery_id);
        await admin.from('push_deliveries').update({status:'sent',sent_at:new Date().toISOString(),error_code:null}).in('id',ids);
        sent+=group.jobs.length;
      }catch(error:any){
        const statusCode=Number(error?.statusCode||error?.status||0);
        const code=statusCode?`HTTP_${statusCode}`:'SEND_FAILED';
        const ids=group.jobs.map(job=>job.delivery_id);
        await admin.from('push_deliveries').update({status:'failed',error_code:code}).in('id',ids);
        if(statusCode===404||statusCode===410){
          await admin.from('push_subscriptions').update({enabled:false,updated_at:new Date().toISOString()}).eq('id',first.subscription_id);
          retired+=1;
        }
        failed+=group.jobs.length;
      }
    }

    return json({ok:true,claimed:jobs.length,groups:groups.length,sent,failed,retired,copyVersion:'v96'});
  }
};
