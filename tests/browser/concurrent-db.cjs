// Test-only harness. Does not change production files or contact hosted Supabase.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const out = path.join(root,'.artifacts/release');
fs.mkdirSync(out,{recursive:true});
const { PGlite } = require(path.join(root, 'node_modules/@electric-sql/pglite'));
const { chromium } = require(path.join(root, 'node_modules/@playwright/test'));
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const tables = ['tasks','notes','note_folders','habits','habit_entries','focus_sessions','user_settings','profiles'];
const results = [], pages = new Set();
let db, browser, server, base, tail = Promise.resolve();
const serialize = fn => { const p = tail.then(fn); tail = p.catch(()=>{}); return p; };
const asUser = (uid, fn) => serialize(async () => {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
  try { return await fn(); } finally { await db.exec('reset role'); }
});
async function check(name, fn) {
  try { await fn(); results.push({name,status:'PASS'}); console.log('PASS '+name); }
  catch(e) { results.push({name,status:'FAIL',reason:String(e.message).slice(0,1200)}); console.log('FAIL '+name+': '+String(e.message).slice(0,600)); }
}
async function until(fn, label, ms=15000) {
  const deadline=Date.now()+ms; let value;
  do { value=await fn(); if(value)return; await new Promise(r=>setTimeout(r,100)); } while(Date.now()<deadline);
  throw Error('Timed out: '+label);
}
async function dbRequest(uid, request) {
  assert.ok(tables.includes(request.table));
  return asUser(uid, async()=>{
    try {
      if(request.type==='select') {
        const key=request.table==='profiles'?'id':'user_id';
        const data=await db.query(`select * from public.${request.table} where ${key}=$1 order by ${request.table==='user_settings'?'user_id':'id'}`, [request.filter || uid]);
        // PostgREST returns JSON/ISO timestamps, not PGlite's JS Date objects.
        const rows=JSON.parse(JSON.stringify(data.rows.slice(request.start||0,(request.end??99999)+1)));
        for(const row of rows)for(const k of ['scheduled_for','entry_date'])if(row[k])row[k]=row[k].slice(0,10);
        return {data:rows,error:null};
      }
      const row=request.row, keys=Object.keys(row);
      assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)));
      const conflict=request.table==='user_settings'?['user_id']:request.table==='habit_entries'?['user_id','habit_id','entry_date']:['id'];
      const sql=`insert into public.${request.table} (${keys.join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')}) on conflict (${conflict.join(',')}) do update set ${keys.filter(k=>!conflict.includes(k)).map(k=>`${k}=excluded.${k}`).join(',')}`;
      await db.query(sql,keys.map(k=>row[k]!==null&&typeof row[k]==='object'?JSON.stringify(row[k]):row[k]));
      setTimeout(()=>{for(const page of pages)if(!page.isClosed())page.evaluate(({uid,table})=>window.__deliver?.(uid,table),{uid,table:request.table}).catch(()=>{});},30);
      return {data:null,error:null};
    } catch(e) { return {data:null,error:{code:e.code||'DB_ERROR',message:'Test database rejected operation'}}; }
  });
}
function adapter({uid}) {
  // Auth identity and events are simulated. SQL authorization is not simulated.
  const key='test-only-session';
  if(localStorage.getItem(key)===null)localStorage.setItem(key,uid);
  const user=()=>{const id=localStorage.getItem(key);return id?{id,email:(id===uid?'test-a':'test-b')+'@example.invalid'}:null;};
  const channels=[]; let authListener;
  const auth={
    getSession:async()=>({data:{session:user()?{user:user()}:null},error:null}),
    onAuthStateChange:fn=>{authListener=fn;return {data:{subscription:{unsubscribe(){authListener=null;}}}};},
    signOut:async()=>{localStorage.setItem(key,'');authListener?.('SIGNED_OUT',null);return{error:null};},
    signInWithPassword:async()=>{localStorage.setItem(key,uid);const session={user:user()};authListener?.('SIGNED_IN',session);return{data:{session,user:user()},error:null};}
  };
  const client={auth,rpc:async name=>({data:name==='sever_sync_protocol'?1:null,error:null}),from(table){return {
    select(){const req={type:'select',table};return{eq(k,v){req.filter=v;return this;},order(){return this;},range(start,end){return navigator.onLine?window.__db({...req,start,end}):Promise.resolve({data:null,error:{code:'NETWORK_ERROR'}});}};},
    upsert(row){return navigator.onLine?window.__db({type:'upsert',table,row}):Promise.resolve({error:{code:'NETWORK_ERROR'}});}
  };},channel(){const c={handlers:[],active:false,on(type,filter,fn){this.handlers.push({filter,fn});return this;},subscribe(fn){this.status=fn;this.active=true;channels.push(this);queueMicrotask(()=>fn('SUBSCRIBED'));return this;},async unsubscribe(){this.active=false;this.status?.('CLOSED');}};return c;}};
  window.__deliver=(id,table)=>{if(!navigator.onLine)return;for(const c of channels)if(c.active)for(const h of c.handlers)if(h.filter.table===table&&h.filter.filter===`user_id=eq.${id}`)h.fn();};
  window.__breakRealtime=()=>{for(const c of channels)if(c.active)c.status('CHANNEL_ERROR');};
  window.__channelCount=()=>channels.length;
  window.SeverSupabase={configured:()=>true,ready:async()=>client,getClient:async()=>client,retry:async()=>client,health:()=>({configured:true,sdkLoaded:true,clientReady:true,lastErrorCode:null})};
  window.dispatchEvent(new CustomEvent('sever:supabase-ready'));
}
async function context(uid,mobile=false) {
  const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  await ctx.exposeBinding('__db',(_,request)=>dbRequest(uid,request));
  await ctx.route('**/supabase-config.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.SEVER_SUPABASE_CONFIG={};'}));
  await ctx.route('**/js/supabase-client.js*',r=>r.fulfill({contentType:'text/javascript',body:`(${adapter.toString()})(${JSON.stringify({uid})})`}));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
  await ctx.addInitScript(()=>{
    if(!localStorage.getItem('sever-anonymous-state-v1'))localStorage.setItem('sever-anonymous-state-v1',JSON.stringify({tasks:[],notes:[],habits:[],folders:[],checks:{},onboarded:true}));
  });
  return ctx;
}
async function open(ctx) {
  const p=await ctx.newPage();pages.add(p);p.on('close',()=>pages.delete(p));
  await p.goto(base); await p.waitForFunction(()=>window.SeverCloud?.hydrated);
  return p;
}
const snapshot=p=>p.evaluate(()=>structuredClone(SeverApp.getState()));
async function edit(p,fn,arg) {
  await p.evaluate(async({code,arg})=>{
    const state=SeverApp.getState();(0,eval)('('+code+')')(state,arg);
    SeverCloud.capture();await SeverApp.persist();SeverApp.render();await SeverCloud.flush();
  },{code:fn.toString(),arg});
}
const drain=p=>p.evaluate(async()=>{await SeverCloud.flush();return{queue:SeverCloud.queued.length,error:SeverCloud.lastErrorCode,status:SeverCloud.status};});
async function converge(ps) {
  for(let i=0;i<4;i++){for(const p of ps)await p.evaluate(async()=>{await SeverCloud.pull();await SeverCloud.flush();});await new Promise(r=>setTimeout(r,150));}
  try {
    await until(async()=>{const ds=await Promise.all(ps.map(drain));return ds.every(d=>d.queue===0&&d.status==='synced');},'settled upload queues',15000);
  } catch(e) {
    throw e;
  }
}
async function main() {
  db=new PGlite();
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create publication supabase_realtime;");
  for(const file of fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8').replace('create extension if not exists pgcrypto;',''));
  // Deployment retry must not rewrite or delete data.
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/005_field_version_sync.sql'),'utf8'));
  await db.exec(`grant select,insert,update,delete on ${tables.filter(t=>t!=='profiles').map(t=>'public.'+t).join(',')} to authenticated;grant select on public.profiles to authenticated;`);
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[A,'regression-a@example.invalid',B,'regression-b@example.invalid']);
  await check('DB ordinary identities and RLS enabled on all eight tables',async()=>{
    await asUser(A,async()=>{
      const r=(await db.query("select current_user as role,rolbypassrls as bypass from pg_roles where rolname=current_user")).rows[0];
      assert.equal(r.role,'authenticated');assert.equal(r.bypass,false);
      assert.equal((await db.query('select role from profiles')).rows[0].role,'user');
    });
    const r=await db.query("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname=any($1)",[tables]);
    assert.equal(r.rows.length,8);assert.ok(r.rows.every(r=>r.relrowsecurity));
  });
  server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':decodeURIComponent(new URL(req.url,'http://localhost').pathname)));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':file.endsWith('.js')||file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream','Cache-Control':'no-store'});res.end(e?'Not found':data);});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/`;
  browser=await chromium.launch(process.env.SEVER_BROWSER_CHANNEL?{channel:process.env.SEVER_BROWSER_CHANNEL}:{});
  const desktop=await context(A),mobile=await context(A,true),other=await context(B);
  let p=await open(desktop),m=await open(mobile),b=await open(other);
  const ids={task:randomUUID(),note:randomUUID(),folder:randomUUID(),habit:randomUUID(),focus:randomUUID()};
  await check('Desktop to mobile: all entity types and settings via runtime + PostgreSQL',async()=>{
    await edit(p,(s,id)=>{const t=Date.now(),date=new Date().toLocaleDateString('sv-SE');
      s.tasks.push({id:id.task,title:'Desktop task',date,duration:25,category:'Regression tag',completed:false,createdAt:t,updatedAt:t});
      s.folders.push({id:id.folder,name:'Desktop folder',createdAt:t,updatedAt:t});
      s.notes.push({id:id.note,title:'Desktop note',body:'Body',folderId:id.folder,kind:'text',items:[],createdAt:t,updatedAt:t});
      s.habits.push({id:id.habit,title:'Regression habit',createdAt:t,updatedAt:t});s.checks[id.habit]=[date];
      s.focusSessions.push({id:id.focus,taskId:id.task,durationMinutes:25,startedAt:t-1500000,completedAt:t,status:'completed',createdAt:t,updatedAt:t});
      s.profile.name='Regression A';s.appearance.theme='focus';
    },ids);
    await until(async()=>(await snapshot(m)).tasks.some(x=>x.id===ids.task),'automatic event delivery');
    await converge([p,m]);const s=await snapshot(m);
    assert.ok(s.notes.some(x=>x.id===ids.note&&x.folderId===ids.folder));assert.ok(s.folders.some(x=>x.id===ids.folder));
    assert.ok(s.focusSessions.some(x=>x.id===ids.focus));assert.equal(s.checks[ids.habit].length,1);assert.equal(s.profile.name,'Regression A');assert.equal(s.appearance.theme,'focus');
    assert.ok(s.tasks.some(x=>x.category==='Regression tag'));
  });
  await check('Mobile to desktop: edits, progress and settings',async()=>{
    await edit(m,(s,id)=>{s.tasks.find(x=>x.id===id.task).completed=true;s.tasks.find(x=>x.id===id.task).completedAt=Date.now();
      s.notes.find(x=>x.id===id.note).body='Mobile body';s.folders.find(x=>x.id===id.folder).name='Mobile folder';s.appearance.theme='cozy';},ids);
    await until(async()=>(await snapshot(p)).notes.some(x=>x.body==='Mobile body'),'reverse event delivery');await converge([p,m]);
    const s=await snapshot(p);assert.equal(s.tasks.find(x=>x.id===ids.task).completed,true);assert.equal(s.appearance.theme,'cozy');assert.equal(s.folders.find(x=>x.id===ids.folder).name,'Mobile folder');
  });
  await check('B UI cannot see A data',async()=>{
    await converge([b]);const s=await snapshot(b);
    for(const k of ['tasks','notes','folders','habits','focusSessions'])assert.equal(s[k].length,0,k);
    assert.ok(!(await b.locator('body').innerText()).includes('Mobile body'));
  });
  await check('B can save its own data; A does not receive B data',async()=>{
    const id=randomUUID();await edit(b,(s,id)=>{s.tasks.push({id,title:'B private task',date:new Date().toLocaleDateString('sv-SE'),duration:10,createdAt:Date.now(),updatedAt:Date.now()});},id);
    await converge([p,m,b]);assert.ok((await snapshot(b)).tasks.some(t=>t.id===id));
    assert.ok(!(await snapshot(p)).tasks.some(t=>t.id===id));assert.ok(!(await snapshot(m)).tasks.some(t=>t.id===id));
  });
  for(const table of tables)await check(`RLS ${table}: B cannot read/update/delete A`,async()=>{
    const key=table==='profiles'?'id':'user_id';
    const own=await asUser(A,()=>db.query(`select * from public.${table} where ${key}=$1`,[A]));
    assert.ok(own.rows.length>0,'A fixture missing');
    await asUser(B,async()=>{
      assert.equal((await db.query(`select * from public.${table} where ${key}=$1`,[A])).rows.length,0);
      if(table==='profiles'){
        await assert.rejects(()=>db.query('update profiles set email=$1 where id=$2',['forbidden@example.invalid',A]),e=>e.code==='42501');
        await assert.rejects(()=>db.query('delete from profiles where id=$1',[A]),e=>e.code==='42501');
      }else{
        assert.equal((await db.query(`update public.${table} set updated_at=now() where user_id=$1 returning *`,[A])).rows.length,0);
        assert.equal((await db.query(`delete from public.${table} where user_id=$1 returning *`,[A])).rows.length,0);
      }
    });
    const after=await asUser(A,()=>db.query(`select * from public.${table} where ${key}=$1`,[A]));assert.deepEqual(after.rows,own.rows);
    if(table!=='profiles'){
      const row=JSON.parse(JSON.stringify(own.rows[0]));
      const attempt=await dbRequest(B,{type:'upsert',table,row});
      assert.equal(attempt.error?.code,'42501','B cannot upsert an A-owned row');
    }
  });
  await check('RLS owner spoofing, primary-key takeover and cross-user relations rejected',async()=>{
    await asUser(B,async()=>{
      await assert.rejects(()=>db.query("insert into tasks(id,user_id,title) values($1,$2,'spoof')",[randomUUID(),A]),e=>e.code==='42501');
      await assert.rejects(()=>db.query("insert into tasks(id,user_id,title) values($1,$2,'takeover') on conflict(id) do update set title=excluded.title",[ids.task,B]),e=>e.code==='42501');
      await assert.rejects(()=>db.query("insert into notes(id,user_id,folder_id,title) values($1,$2,$3,'cross')",[randomUUID(),B,ids.folder]),e=>e.code==='42501');
      await assert.rejects(()=>db.query("insert into focus_sessions(id,user_id,task_id,duration_minutes,status) values($1,$2,$3,25,'completed')",[randomUUID(),B,ids.task]),e=>e.code==='42501');
      await assert.rejects(()=>db.query("insert into habit_entries(user_id,habit_id,entry_date) values($1,$2,current_date)",[B,ids.habit]),e=>e.code==='42501');
    });
  });
  await check('Concurrent distinct records survive without duplicate IDs',async()=>{
    const add=(s,id)=>{const t=Date.now();s.tasks.push({id,title:'Concurrent '+id,date:new Date().toLocaleDateString('sv-SE'),duration:15,createdAt:t,updatedAt:t});};
    const x=randomUUID(),y=randomUUID();await Promise.all([edit(p,add,x),edit(m,add,y)]);await converge([p,m]);
    for(const page of [p,m]){const s=await snapshot(page);assert.equal(s.tasks.filter(t=>t.id===x).length,1);assert.equal(s.tasks.filter(t=>t.id===y).length,1);assert.equal(new Set(s.tasks.map(t=>t.id)).size,s.tasks.length);}
  });
  await check('Same-record conflict: newer edit survives stale offline upload',async()=>{
    await mobile.setOffline(true);
    await edit(m,(s,id)=>{s.tasks.find(t=>t.id===id).title='Older offline edit';},ids.task);
    await new Promise(r=>setTimeout(r,80));
    await edit(p,(s,id)=>{s.tasks.find(t=>t.id===id).title='Newer desktop edit';},ids.task);
    await mobile.setOffline(false);await converge([m,p]);
    for(const page of [p,m])assert.equal((await snapshot(page)).tasks.find(t=>t.id===ids.task).title,'Newer desktop edit');
  });
  await check('Offline queue survives page close/reopen and reconnect drains it',async()=>{
    await mobile.setOffline(true);
    await edit(m,(s,id)=>{s.notes.find(n=>n.id===id).body='Offline persisted body';},ids.note);
    assert.ok((await m.evaluate(()=>SeverCloud.queued.length))>0);
    await m.close();await mobile.setOffline(false);m=await open(mobile);await converge([m,p]);
    assert.equal((await snapshot(p)).notes.find(n=>n.id===ids.note).body,'Offline persisted body');
  });
  await check('Reload preserves authenticated test scope and all entities',async()=>{
    const before=await snapshot(p);await p.reload();await p.waitForFunction(()=>SeverCloud.hydrated);await converge([p,m]);const s=await snapshot(p);
    for(const k of ['tasks','notes','folders','habits','focusSessions'])assert.deepEqual(s[k].map(x=>x.id).sort(),before[k].map(x=>x.id).sort(),k);
  });
  await check('Logout hides account data; test login restores it without duplicates',async()=>{
    await p.evaluate(()=>SeverCloud.signOut());assert.equal((await snapshot(p)).tasks.length,0);
    await p.evaluate(()=>SeverCloud.signIn('unused@example.invalid','unused-test-adapter',false));await p.waitForFunction(()=>SeverCloud.hydrated);
    await converge([p,m]);assert.ok((await snapshot(p)).tasks.some(x=>x.id===ids.task));
  });
  await check('Realtime channel error/re-subscribe and subsequent event delivery (adapter)',async()=>{
    const n=await m.evaluate(()=>__channelCount());await m.evaluate(()=>__breakRealtime());
    await until(()=>m.evaluate(n=>__channelCount()>n&&SeverCloud.realtimeStatus==='connected',n),'channel reconnect',12000);
    await edit(p,(s,id)=>{s.notes.find(x=>x.id===id).body='After reconnect';},ids.note);
    await until(async()=>(await snapshot(m)).notes.find(x=>x.id===ids.note)?.body==='After reconnect','event following reconnect');
  });
  await check('New independent browser context restores all records from DB only',async()=>{
    const ctx=await context(A,true),q=await open(ctx);await converge([q,p]);const s=await snapshot(q);
    assert.ok(s.tasks.some(x=>x.id===ids.task));assert.equal(s.notes.find(x=>x.id===ids.note).body,'After reconnect');
    assert.ok(s.folders.some(x=>x.id===ids.folder));assert.ok(s.focusSessions.some(x=>x.id===ids.focus));assert.equal(s.appearance.theme,'cozy');await ctx.close();
  });
  await check('Concurrent different fields of the same record retain BOTH edits (strict no-loss requirement)',async()=>{
    await converge([p,m]);
    await desktop.setOffline(true);await mobile.setOffline(true);
    await edit(p,(s,id)=>{s.tasks.find(t=>t.id===id).title='Concurrent title to preserve';},ids.task);
    await new Promise(r=>setTimeout(r,100));
    await edit(m,(s,id)=>{s.tasks.find(t=>t.id===id).category='Concurrent category to preserve';},ids.task);
    await desktop.setOffline(false);await mobile.setOffline(false);await converge([p,m]);
    for(const page of [p,m]){const task=(await snapshot(page)).tasks.find(t=>t.id===ids.task);
      assert.equal(task.title,'Concurrent title to preserve','Earlier title edit was silently lost when later category edit won');
      assert.equal(task.category,'Concurrent category to preserve');
    }
  });
  await check('B/E: repeated offline edits of same field converge deterministically',async()=>{
    await converge([p,m]);await desktop.setOffline(true);await mobile.setOffline(true);
    await edit(p,(s,id)=>{s.tasks.find(t=>t.id===id).title='Desktop first';},ids.task);
    await edit(p,(s,id)=>{s.tasks.find(t=>t.id===id).title='Desktop second';},ids.task);
    await edit(m,(s,id)=>{s.tasks.find(t=>t.id===id).title='Mobile first';},ids.task);
    await edit(m,(s,id)=>{s.tasks.find(t=>t.id===id).title='Mobile second';},ids.task);
    const expected=await p.evaluate(async remote=>{
      const {mergeStates}=await import('/js/sync-core.mjs?v=55');return mergeStates(SeverApp.getState(),remote).tasks.find(t=>t.id===remote.tasks.find(x=>x.title==='Mobile second').id).title;
    },await snapshot(m));
    await desktop.setOffline(false);await mobile.setOffline(false);await converge([p,m]);
    for(const page of [p,m])assert.equal((await snapshot(page)).tasks.find(t=>t.id===ids.task).title,expected);
  });
  await check('C: SQL delete wins against a later offline stale edit',async()=>{
    await converge([p,m]);await desktop.setOffline(true);await mobile.setOffline(true);
    await edit(m,(s,id)=>{s.tasks=s.tasks.filter(t=>t.id!==id);},ids.task);
    await edit(p,(s,id)=>{s.tasks.find(t=>t.id===id).title='Must not resurrect';},ids.task);
    await desktop.setOffline(false);await mobile.setOffline(false);await converge([p,m]);
    for(const page of [p,m])assert.ok(!(await snapshot(page)).tasks.some(t=>t.id===ids.task));
  });
  await check('D: UI task delete/Undo restores same ID and survives repeated stale tombstone delivery',async()=>{
    // Restore through the application's real Undo handler, not a cloned implementation.
    const tombstone=await m.evaluate(id=>SeverApp.getState().syncMeta.tombstones['tasks:'+id],ids.task);
    await edit(m,(s,row)=>{s.tasks.push({...row,deletedAt:null,updatedAt:Date.now()});delete s.syncMeta.tombstones['tasks:'+row.id];},tombstone);
    await converge([p,m]);
    await m.evaluate(()=>SeverApp.switchView('today'));
    const first=m.locator('#todayTasks .task').filter({hasText:await m.evaluate(id=>SeverApp.getState().tasks.find(t=>t.id===id).title,ids.task)});
    await first.locator('.task-open').click();await m.locator('#taskActionDelete').click();
    await m.locator('#toast button').click();await converge([p,m]);
    const stale=await asUser(A,()=>db.query('select * from tasks where id=$1',[ids.task]));
    const row=stale.rows[0],generation=row.sync_versions.life.generation;
    assert.ok(generation>=2);
    const old={...JSON.parse(JSON.stringify(row)),deleted_at:new Date(tombstone.deletedAt).toISOString(),sync_versions:tombstone.syncVersions};
    for(let i=0;i<3;i++)assert.equal((await dbRequest(A,{type:'upsert',table:'tasks',row:old})).error,null);
    await converge([p,m]);for(const page of [p,m])assert.equal((await snapshot(page)).tasks.filter(t=>t.id===ids.task).length,1);
  });
  await check('F/G: duplicate writes and multiple reconnects remain idempotent',async()=>{
    const saved=await snapshot(p),row=(await asUser(A,()=>db.query('select * from tasks where id=$1',[ids.task]))).rows[0];
    const json=JSON.parse(JSON.stringify(row));if(json.scheduled_for)json.scheduled_for=json.scheduled_for.slice(0,10);
    for(let i=0;i<3;i++){assert.equal((await dbRequest(A,{type:'upsert',table:'tasks',row:json})).error,null);await mobile.setOffline(true);await mobile.setOffline(false);await converge([p,m]);}
    for(const page of [p,m]){
      const s=await snapshot(page);assert.equal(s.tasks.filter(t=>t.id===ids.task).length,1);
      assert.equal(s.tasks.find(t=>t.id===ids.task).title,saved.tasks.find(t=>t.id===ids.task).title);
      assert.deepEqual(s.syncMeta.fieldVersions['tasks:'+ids.task],saved.syncMeta.fieldVersions['tasks:'+ids.task]);
    }
  });
  await check('Legacy client cannot overwrite versioned rows; legacy records remain readable',async()=>{
    const row=(await asUser(A,()=>db.query('select * from tasks where id=$1',[ids.task]))).rows[0];
    const legacy={id:ids.task,user_id:A,title:'Old client overwrite',updated_at:new Date(Date.now()+100000).toISOString()};
    assert.equal((await dbRequest(A,{type:'upsert',table:'tasks',row:legacy})).error?.code,'40001');
    assert.equal((await asUser(A,()=>db.query('select title from tasks where id=$1',[ids.task]))).rows[0].title,row.title);
    assert.equal((await db.query('select public.sever_sync_protocol() as v')).rows[0].v,1);
  });
  await check('Malformed field metadata is rejected without corrupting the row',async()=>{
    const row=JSON.parse(JSON.stringify((await asUser(A,()=>db.query('select * from tasks where id=$1',[ids.task]))).rows[0]));
    if(row.scheduled_for)row.scheduled_for=row.scheduled_for.slice(0,10);
    const malformed=structuredClone(row);malformed.sync_versions.life.generation=-1;
    assert.equal((await dbRequest(A,{type:'upsert',table:'tasks',row:malformed})).error?.code,'22023');
    const current=JSON.parse(JSON.stringify((await asUser(A,()=>db.query('select * from tasks where id=$1',[ids.task]))).rows[0]));
    if(current.scheduled_for)current.scheduled_for=current.scheduled_for.slice(0,10);
    assert.deepEqual(current,row);
  });
}
main().catch(e=>{results.push({name:'harness',status:'FAIL',reason:String(e.stack)});console.log('FAIL harness: '+String(e.stack));process.exitCode=1;}).finally(async()=>{
  await browser?.close();if(server)await new Promise(r=>server.close(r));await tail;await db?.close();
  const report={scope:'working tree: real application + PGlite migrations; simulated Auth/Realtime transport; no hosted Supabase',results,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length};
  fs.writeFileSync(path.join(out,'concurrent-db.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;
});
