import { fail,uuid } from './validation.ts';
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(secret:string) {
  if(secret.length<24)fail('CONFIG_MISSING','Подтверждение действий ещё не настроено.',503);
  return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function signAction(action:any,userId:string,secret:string,now=Date.now()) {
  const payload={...action,userId,id:crypto.randomUUID(),expires:now+10*60000};
  const bytes=new TextEncoder().encode(JSON.stringify(payload)),sig=await crypto.subtle.sign('HMAC',await key(secret),bytes);
  return {token:encode(bytes)+'.'+encode(new Uint8Array(sig)),preview:action};
}
export async function verifyAction(token:string,userId:string,secret:string,now=Date.now()) {
  try {
    if(typeof token!=='string'||token.length>80000)throw Error();
    const parts=token.split('.');if(parts.length!==2)throw Error();
    const bytes=decode(parts[0]);
    if(!await crypto.subtle.verify('HMAC',await key(secret),decode(parts[1]),bytes))throw Error();
    const payload=JSON.parse(new TextDecoder().decode(bytes));
    if(payload.userId!==userId||payload.expires<now||!Number.isFinite(payload.expires))throw Error();
    uuid(payload.id);return payload;
  }catch{fail('CONFIRMATION_INVALID','Подтверждение устарело. Запросите новый вариант.',409);}
}
