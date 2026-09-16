import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

type Provider='apple'|'google';
type Subscription={id:string;endpoint:string;p256dh:string;auth:string};
type ProviderResponse={statusCode?:number};
const TABLE='push_probe_attempts_v120';
const allowedReasons=new Set([
  'BadTtl','BadUrgency','BadWebPushRequest','BadWebPushTopic','VapidPkHashMismatch',
  'IdleTimeout','BadAuthorizationHeader','BadJwtToken','BadVapidPublicKey',
  'BadPath','MethodNotAllowed','PayloadTooLarge','TooManyRequests',
  'InternalServerError','ServiceUnavailable','Shutdown',
  'INVALID_ARGUMENT','UNREGISTERED','SENDER_ID_MISMATCH','THIRD_PARTY_AUTH_ERROR',
  'QUOTA_EXCEEDED','PERMISSION_DENIED','UNAUTHENTICATED','NOT_FOUND',
  'InvalidRegistration','MismatchSenderId','UnauthorizedRegistration','InvalidVapidKey'
]);
const reply=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
function tokenMatches(actual:string,expected:string){
  const a=Buffer.from(actual),b=Buffer.from(expected);
  return Boolean(actual&&expected&&a.length===b.length&&timingSafeEqual(a,b));
}
function providerFor(endpoint:string):Provider|null{
  try{
    const url=new URL(endpoint);
    if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash) return null;
    if(url.hostname==='web.push.apple.com') return 'apple';
    if(url.hostname==='fcm.googleapis.com') return 'google';
  }catch{/* Fail closed on malformed/untrusted endpoints. */}
  return null;
}
function safeStatus(value:unknown){
  const number=Number(value);
  return Number.isInteger(number)&&number>=100&&number<=599?number:null;
}
function safeProviderReason(error:unknown){
  const maybe=error as {body?:unknown};
  if(typeof maybe?.body!=='string'||maybe.body.length>8192) return 'UNCLASSIFIED';
  try{
    const parsed=JSON.parse(maybe.body);
    const reason=typeof parsed?.reason==='string'?parsed.reason:
      typeof parsed?.error==='string'?parsed.error:parsed?.error?.status;
    return typeof reason==='string'&&allowedReasons.has(reason)?reason:'UNCLASSIFIED';
  }catch{return 'UNCLASSIFIED';}
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
    if(!tokenMatches(req.headers.get('x-sever-cron-token')||'',secrets.cron_token||''))
      return reply({error:'UNAUTHORIZED'},401);
    if(!secrets.vapid_public||!secrets.vapid_private) return reply({error:'PUSH_CONFIG'},503);

    // A single owner and exactly two active Apple/Google devices: no fan-out to others.
    const owners=await admin.from('profiles').select('id').eq('role','owner').limit(2);
    if(owners.error||owners.data?.length!==1) return reply({error:'OWNER_SCOPE'},409);
    const subs=await admin.from('push_subscriptions')
      .select('id,endpoint,p256dh,auth').eq('user_id',owners.data[0].id).eq('enabled',true)
      .order('created_at',{ascending:true}).limit(3);
    if(subs.error||subs.data?.length!==2) return reply({error:'DEVICE_SCOPE'},409);
    const devices=(subs.data as Subscription[]).map(item=>({...item,provider:providerFor(item.endpoint)}));
    if(devices.some(item=>!item.provider)||new Set(devices.map(item=>item.provider)).size!==2)
      return reply({error:'PROVIDER_SCOPE'},409);
    webpush.setVapidDetails('https://golovalisaia-hub.github.io/sever-planner/',secrets.vapid_public,secrets.vapid_private);

    const results:Array<{provider:Provider;outcome:string;httpStatus?:number|null;reason?:string}>=[];
    for(const device of devices){
      const provider=device.provider as Provider;
      // The PK reservation is atomic: any retry/concurrent invocation cannot send twice.
      const claim=await admin.from(TABLE)
        .insert({subscription_id:device.id,provider,status:'claimed'})
        .select('subscription_id').single();
      if(claim.error){
        results.push({provider,outcome:claim.error.code==='23505'?'already_attempted':'ledger_error'});
        continue;
      }
      const payload={
        title:'SEVER · проверка доставки',
        body:'Одноразовая проверка уведомлений с сервера.',
        tag:'sever-provider-probe-v120',url:'./?view=today'
      };
      try{
        const sent=(await webpush.sendNotification(
          {endpoint:device.endpoint,keys:{p256dh:device.p256dh,auth:device.auth}},
          JSON.stringify(payload),{TTL:300,urgency:'normal',topic:'sever-probe-v120'}
        )) as ProviderResponse;
        const httpStatus=safeStatus(sent?.statusCode);
        const updated=await admin.from(TABLE).update({
          status:'sent',http_status:httpStatus,reason:null,finished_at:new Date().toISOString()
        }).eq('subscription_id',device.id);
        results.push({provider,outcome:updated.error?'status_write_failed':'accepted',httpStatus});
      }catch(error:unknown){
        const status=error as {statusCode?:number;status?:number};
        const httpStatus=safeStatus(status?.statusCode??status?.status);
        const reason=safeProviderReason(error);
        const updated=await admin.from(TABLE).update({
          status:'failed',http_status:httpStatus,reason,finished_at:new Date().toISOString()
        }).eq('subscription_id',device.id);
        results.push({provider,outcome:updated.error?'status_write_failed':'rejected',httpStatus,reason});
      }
    }
    return reply({ok:true,results});
  }
};
