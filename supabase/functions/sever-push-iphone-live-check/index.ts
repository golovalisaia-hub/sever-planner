import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

const TABLE='push_iphone_live_check_v126';
const reasons=new Set(['BadTtl','BadUrgency','BadWebPushRequest','BadWebPushTopic','VapidPkHashMismatch','BadAuthorizationHeader','BadJwtToken','BadVapidPublicKey','BadPath','PayloadTooLarge','TooManyRequests','InternalServerError','ServiceUnavailable','Shutdown']);
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
function authorized(given:string,expected:string){
  const a=Buffer.from(given),b=Buffer.from(expected);
  return Boolean(given&&expected&&a.length===b.length&&timingSafeEqual(a,b));
}
function isAppleEndpoint(value:string){
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&url.hostname==='web.push.apple.com'&&!url.port&&!url.username&&!url.password&&!url.hash;
  }catch{return false;}
}
function statusCode(value:unknown){
  const number=Number(value);
  return Number.isInteger(number)&&number>=100&&number<=599?number:null;
}
function providerReason(error:unknown){
  const body=(error as {body?:unknown})?.body;
  if(typeof body!=='string'||body.length>8192) return 'UNCLASSIFIED';
  try{
    const parsed=JSON.parse(body);
    const reason=typeof parsed?.reason==='string'?parsed.reason:parsed?.error?.status;
    return typeof reason==='string'&&reasons.has(reason)?reason:'UNCLASSIFIED';
  }catch{return 'UNCLASSIFIED';}
}
type Device={id:string;endpoint:string;p256dh:string;auth:string;user_agent:string|null;last_seen_at:string|null};
function chooseIphone(subscriptions:Device[]):Device|null{
  // Do not silently pick one among equally active devices or touch another
  // installation's subscription. The account currently has an older iPhone
  // record, so a strict one-Apple-only condition would reject a legitimate test.
  const apple=subscriptions.filter(item=>isAppleEndpoint(item.endpoint)&&/iPhone/i.test(item.user_agent||''));
  if(apple.length<1||apple.length>2) return null;
  const sorted=apple.sort((a,b)=>Date.parse(b.last_seen_at||'')-Date.parse(a.last_seen_at||''));
  const newest=Date.parse(sorted[0].last_seen_at||'');
  const now=Date.now();
  if(!Number.isFinite(newest)||newest>now+300000||now-newest>86400000) return null;
  if(sorted.length===2){
    const older=Date.parse(sorted[1].last_seen_at||'');
    if(!Number.isFinite(older)||newest-older<1800000) return null;
  }
  return sorted[0];
}
export default {
  async fetch(req:Request):Promise<Response>{
    if(req.method!=='POST') return reply({error:'METHOD_NOT_ALLOWED'},405);
    const url=Deno.env.get('SUPABASE_URL')||'';
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
    if(!url||!serviceKey) return reply({error:'SERVER_CONFIG'},503);
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const loaded=await admin.rpc('sever_push_runtime_secrets').single();
    if(loaded.error||!loaded.data) return reply({error:'PUSH_CONFIG'},503);
    const secrets=loaded.data as {vapid_public:string;vapid_private:string;cron_token:string};
    if(!authorized(req.headers.get('x-sever-cron-token')||'',secrets.cron_token||'')) return reply({error:'UNAUTHORIZED'},401);
    if(!secrets.vapid_public||!secrets.vapid_private) return reply({error:'PUSH_CONFIG'},503);

    const owners=await admin.from('profiles').select('id').eq('role','owner').limit(2);
    if(owners.error||owners.data?.length!==1) return reply({error:'OWNER_SCOPE'},409);
    const subs=await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth,user_agent,last_seen_at')
      .eq('user_id',owners.data[0].id).eq('enabled',true).order('last_seen_at',{ascending:false}).limit(5);
    if(subs.error||!subs.data||subs.data.length>4) return reply({error:'DEVICE_SCOPE'},409);
    const device=chooseIphone(subs.data as Device[]);
    if(!device) return reply({error:'APPLE_SCOPE'},409);

    const claim=await admin.from(TABLE).insert({subscription_id:device.id,status:'claimed'})
      .select('subscription_id').single();
    if(claim.error) return reply({ok:false,outcome:claim.error.code==='23505'?'already_attempted':'ledger_error'},409);

    webpush.setVapidDetails('https://golovalisaia-hub.github.io/sever-planner/',secrets.vapid_public,secrets.vapid_private);
    const payload={title:'SEVER · проверка сейчас',body:'Проверяем реальную доставку уведомления на iPhone.',tag:'sever-iphone-live-check-v126',url:'./?view=today'};
    try{
      const result=await webpush.sendNotification(
        {endpoint:device.endpoint,keys:{p256dh:device.p256dh,auth:device.auth}},
        JSON.stringify(payload),{TTL:600,urgency:'high'}
      );
      const httpStatus=statusCode(result?.statusCode);
      const saved=await admin.from(TABLE).update({status:'sent',http_status:httpStatus,reason:null,finished_at:new Date().toISOString()})
        .eq('subscription_id',device.id);
      return reply({ok:!saved.error,provider:'apple',outcome:saved.error?'status_write_failed':'accepted',httpStatus});
    }catch(error:unknown){
      const info=error as {statusCode?:number;status?:number};
      const httpStatus=statusCode(info?.statusCode??info?.status);
      const reason=providerReason(error);
      const saved=await admin.from(TABLE).update({status:'failed',http_status:httpStatus,reason,finished_at:new Date().toISOString()})
        .eq('subscription_id',device.id);
      return reply({ok:!saved.error,provider:'apple',outcome:saved.error?'status_write_failed':'rejected',httpStatus,reason});
    }
  }
};
