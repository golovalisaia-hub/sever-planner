import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createECDH, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

// Admin-only diagnostic: never send a push, change a subscription or return key material.
const json = (body:unknown, status=200) => new Response(JSON.stringify(body), {
  status, headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' }
});

function authorized(presented:string, expected:string){
  const left=Buffer.from(presented), right=Buffer.from(expected);
  return Boolean(presented && expected && left.length===right.length && timingSafeEqual(left,right));
}

function inspectPair(publicKey:string, privateKey:string){
  const publicFormat=/^[A-Za-z0-9_-]{87}$/.test(publicKey);
  const privateFormat=/^[A-Za-z0-9_-]{43}$/.test(privateKey);
  const publicBytes=publicFormat ? Buffer.from(publicKey,'base64url') : Buffer.alloc(0);
  const privateBytes=privateFormat ? Buffer.from(privateKey,'base64url') : Buffer.alloc(0);
  const publicKeyValid=publicBytes.length===65 && publicBytes[0]===4;
  const privateKeyValid=privateBytes.length===32;
  if(!publicKeyValid||!privateKeyValid) return { publicKeyValid, privateKeyValid, keyPairMatches:false };
  try {
    const ecdh=createECDH('prime256v1');
    ecdh.setPrivateKey(privateBytes);
    const derived=ecdh.getPublicKey(undefined,'uncompressed');
    return { publicKeyValid, privateKeyValid, keyPairMatches:derived.length===publicBytes.length && timingSafeEqual(derived,publicBytes) };
  } catch {
    return { publicKeyValid, privateKeyValid:false, keyPairMatches:false };
  }
}

export default {
  async fetch(req:Request):Promise<Response>{
    if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
    const url=Deno.env.get('SUPABASE_URL')||'';
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
    if(!url||!serviceKey) return json({error:'SERVER_CONFIG'},503);
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const secretsResult=await admin.rpc('sever_push_runtime_secrets').single();
    if(secretsResult.error||!secretsResult.data) return json({error:'PUSH_CONFIG'},503);
    const secrets=secretsResult.data as {vapid_public:string;vapid_private:string;cron_token:string};
    if(!authorized(req.headers.get('x-sever-cron-token')||'',secrets.cron_token||'')) return json({error:'UNAUTHORIZED'},401);
    return json({ok:true,...inspectPair(secrets.vapid_public||'',secrets.vapid_private||'')});
  }
};
