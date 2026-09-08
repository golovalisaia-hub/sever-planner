import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const packageRoot=process.env.SEVER_SQL_TEST_ROOT || path.resolve('node_modules');
test('migration executes in PostgreSQL and enforces role, RLS, quotas and atomic plans',{skip:!packageRoot?'Set SEVER_SQL_TEST_ROOT to a test-only pglite installation':false},async()=>{
  const {PGlite}=require(path.join(packageRoot,'@electric-sql/pglite'));
  const db=new PGlite();
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth,public to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role; create publication supabase_realtime;");
    // pgcrypto is a Supabase preinstalled extension; gen_random_uuid is built into this PostgreSQL runtime.
    for(const name of ['001_initial_cloud_sync.sql','002_security_hardening.sql','003_sever_ai.sql','004_fix_relation_owner_trigger.sql']){
      const sql=readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8').replace('create extension if not exists pgcrypto;','');
      await db.exec(sql);
    }
    await db.exec("grant select,insert,update,delete on public.tasks,public.notes to authenticated; grant select on public.profiles to authenticated;");
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[a,'a@example.invalid',b,'b@example.invalid']);
    assert.deepEqual((await db.query('select role from public.profiles order by id')).rows.map(r=>r.role),['user','user']);
    await db.query("update public.profiles set role='owner' where id=$1",[a]);
    await assert.rejects(()=>db.query("update public.profiles set role='owner' where id=$1",[b]),e=>e.code==='23505');
    const asUser=async(id,fn)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn();}finally{await db.exec('reset role');}};
    await asUser(b,async()=>{
      await assert.rejects(()=>db.query("update public.profiles set role='owner' where id=$1",[b]),e=>e.code==='42501');
      await assert.rejects(()=>db.query('select public.sever_ai_system_usage()'),e=>e.code==='42501');
      for(let i=0;i<3;i++)assert.equal((await db.query("select public.sever_claim_ai_quota($1,'test','test') as allowed",[crypto.randomUUID()])).rows[0].allowed,true);
      assert.equal((await db.query("select public.sever_claim_ai_quota($1,'test','test') as allowed",[crypto.randomUUID()])).rows[0].allowed,false);
      await assert.rejects(()=>db.query("insert into public.ai_memories(user_id,content) values($1,'spoof')",[a]),e=>e.code==='42501');
      await db.query("insert into public.ai_memories(content) values('Own preference')");
    });
    await asUser(a,async()=>assert.equal((await db.query('select * from public.ai_memories')).rows.length,0));
    const planId=crypto.randomUUID(),taskId=crypto.randomUUID();
    const plan={id:planId,kind:'financial_goal',title:'Test plan',data:{taskIds:[taskId]}};
    await asUser(b,async()=>{
      const tasks=[{id:taskId,title:'Payment',date:'2026-09-08',durationMinutes:30}];
      const create=()=>db.query('select public.sever_create_ai_plan($1,$2)',[JSON.stringify(plan),JSON.stringify(tasks)]);
      await create();await create();
      assert.equal((await db.query('select count(*)::integer as n from public.tasks')).rows[0].n,1);
      const badPlan={...plan,id:crypto.randomUUID()};
      await assert.rejects(()=>db.query('select public.sever_create_ai_plan($1,$2)',[JSON.stringify(badPlan),JSON.stringify([{...tasks[0],id:crypto.randomUUID(),durationMinutes:900}])]));
      assert.equal((await db.query('select count(*)::integer as n from public.ai_plans')).rows[0].n,1);
    });
    await asUser(a,async()=>{
      assert.equal((await db.query('select * from public.ai_plans')).rows.length,0);
      assert.equal((await db.query('select * from public.tasks')).rows.length,0);
    });
    await db.exec('set role service_role');
    assert.equal((await db.query('select public.sever_ai_system_usage() as stats')).rows[0].stats.requestsToday,3);
  }finally{await db.close();}
});
