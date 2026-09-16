import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

// Exactly one additional owner-requested test. No browser access or repeat sends.
const TABLE='push_owner_iphone_check_v126';
const allowedReasons=new Set(['BadTtl','BadUrgency','BadWebPushRequest','BadWebPushTopic','VapidPkHashMismatch','BadAuthorizationHeader','BadJwtToken','BadVapidPublicKey','BadPath','PayloadTooLarge','TooManyRequests','InternalServerError','ServiceUnavailable','Shutdown']);
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
function validToken(given:string,expected:string){
  const a=Buffer.from(given),b=Buffer.from(expected);
  return Boolean(given&&expected&&a.length===b.length&&timingSafeEqual(a,b));
}
function isApple(endpoint:string){
  try{const url=new URL(endpoint);return url.protocol==='https:'&&url.hostname==='web.push.apple.com'&&!url.port&&!url.username&&!url.password&&!url.hash;}
  catch{return false;}
}
function safeHttp(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>=100&&n<=599?n:null;}
function safeReason(error:unknown){
  const body=(error as {body?:unknown})?.body;
  if(typeof body!=='string'||body.length>8192)return 'UNCLASSIFIED';
  try{const parsed=JSON.parse(body);const reason=typeof parsed?.reason==='string'?parsed.reason:parsed?.error?.status;
    return typeof reason==='string'&&allowedReasons.has(reason)?reason:'UNCLASSIFIED';}
  catch{return 'UNCLASSIFIED';}
}
export default {
  async fetch(req:Request):Promise<Response>{
    if(req.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
    const url=Deno.env.get('SUPABASE_URL')||'';
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
    if(!url||!serviceKey)return reply({error:'SERVER_CONFIG'},503);
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const loaded=await admin.rpc('sever_push_runtime_secrets').single();
    if(loaded.error||!loaded.data)return reply({error:'PUSH_CONFIG'},503);
    const secrets=loaded.data as {vapid_public:string;vapid_private:string;cron_token:string};
    if(!validToken(req.headers.get('x-sever-cron-token')||'',secrets.cron_token||''))return reply({error:'UNAUTHORIZED'},401);
    if(!secrets.vapid_public||!secrets.vapid_private)return reply({error:'PUSH_CONFIG'},503);
    const owners=await admin.from('profiles').select('id').eq('role','owner').limit(2);
    if(owners.error||owners.data?.length!==1)return reply({error:'OWNER_SCOPE'},409);
    const subs=await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth')
      .eq('user_id',owners.data[0].id).eq('enabled',true).limit(3);
    if(subs.error||!subs.data||subs.data.length>2)return reply({error:'DEVICE_SCOPE'},409);
    const apple=subs.data.filter(item=>isApple(item.endpoint));
    if(apple.length!==1)return reply({error:'APPLE_SCOPE'},409);
    const device=apple[0];
    // This is a follow-up for the SAME subscription, never a replacement device.
    const prior=await admin.from('push_iphone_topic_recovery_v122').select('status,http_status')
      .eq('subscription_id',device.id).maybeSingle();
    if(prior.error||prior.data?.status!=='sent'||prior.data?.http_status!==201)
      return reply({error:'PRIOR_TEST_REQUIRED'},409);
    // Atomic unique claim occurs before network IO; retries and concurrent calls cannot send again.
    const claim=await admin.from(TABLE).insert({subscription_id:device.id,status:'claimed'})
      .select('subscription_id').single();
    if(claim.error)return reply({ok:false,outcome:claim.error.code==='23505'?'already_attempted':'ledger_error'},409);
    webpush.setVapidDetails('https://golovalisaia-hub.github.io/sever-planner/',secrets.vapid_public,secrets.vapid_private);
    const payload={title:'SEVER · проверка доставки № 4',body:'Проверочное уведомление с сервера по вашему запросу.',tag:'sever-owner-check-v126',url:'./?view=today'};
    try{
      // No optional HTTP Topic header (Apple rejected it in v121); payload tag is distinct.
      const response=await webpush.sendNotification(
        {endpoint:device.endpoint,keys:{p256dh:device.p256dh,auth:device.auth}},
        JSON.stringify(payload),{TTL:900,urgency:'high'}
      );
      const httpStatus=safeHttp(response?.statusCode);
      const saved=await admin.from(TABLE).update({status:'sent',http_status:httpStatus,reason:null,finished_at:new Date().toISOString()})
        .eq('subscription_id',device.id);
      return reply({ok:!saved.error,provider:'apple',outcome:saved.error?'status_write_failed':'accepted',httpStatus});
    }catch(error:unknown){
      const detail=error as {statusCode?:number;status?:number};
      const httpStatus=safeHttp(detail?.statusCode??detail?.status);
      const reason=safeReason(error);
      const saved=await admin.from(TABLE).update({status:'failed',http_status:httpStatus,reason,finished_at:new Date().toISOString()})
        .eq('subscription_id',device.id);
      return reply({ok:!saved.error,provider:'apple',outcome:saved.error?'status_write_failed':'rejected',httpStatus,reason});
    }
  }
};
