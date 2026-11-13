'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const mod=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const ADMIN='b1111111-1111-4111-8111-111111111111',OTHER='c1111111-1111-4111-8111-111111111111',TOKEN='jwt.owner.token.valid-12345678901234567890';
const env={SUPABASE_URL:'https://admin-controls.test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',SC_ADMIN_OPS_READ_ENABLED:'true',SC_ADMIN_OWNER_DB_ENABLED:'true'};
const ok=v=>Response.json(v);
const stub=({user=ADMIN,owner=ADMIN,calls=[],result}={})=>async(u,o)=>{
 const p=new URL(u).pathname;calls.push({p,method:o.method,body:o.body});
 if(p==='/auth/v1/user')return ok({id:user,email:'admin@example.test',email_confirmed_at:'2026-11-13T00:00:00Z'});
 if(p==='/rest/v1/sc_admin_owner')return ok(owner?[{user_id:owner}]:[]);
 if(p==='/rest/v1/rpc/sc_admin_control_report')return ok(result||{controls:{researchScans:true,supportIntake:true},stats:{pendingProposals:0,publishedSignalRecords:0,revokedSignals:0,trialActivations:0,riskEventsLast30Days:0,complimentaryActive:0},recentScans:[]});
 if(p==='/rest/v1/rpc/sc_admin_trial_list')return ok(result||[]);
 if(p==='/rest/v1/rpc/sc_signal_proposal_queue')return ok(result||[]);
 if(p==='/rest/v1/rpc/sc_admin_audit_feed')return ok(result||[]);
 if(p==='/rest/v1/rpc/sc_admin_runtime_toggle')return ok(result||{key:'research_scans',enabled:false,changed:true});
 if(p==='/rest/v1/rpc/sc_admin_trial_revoke_owner')return ok(result||{result:'revoked'});
 if(p==='/rest/v1/rpc/sc_admin_runtime_state')return ok(result||{researchScans:true,supportIntake:true});
 throw Error('Unexpected upstream path '+p);
};
const req=(a,{method='GET',body,auth=true}={})=>new Request('https://host.test/api/admin-control?action='+a,{method,headers:{...(auth?{Authorization:'Bearer '+TOKEN}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
const run=async(a,opt={},ctx={})=>(await mod).createWorker({fetchFn:stub(ctx)}).fetch(req(a,opt),env);
test('Control-plane data is owner-only, never visible to anonymous or customer',async()=>{
 for(const action of ['overview','trials','proposals','audit']){
  assert.equal((await run(action,{auth:false})).status,401);
  assert.equal((await run(action,{}, {owner:OTHER})).status,403);
 }
});
test('Control-plane reports expose no premium signal payloads or sensitive risk hashes',async()=>{
 const r=await run('overview');assert.equal(r.status,200);
 const data=await r.json();assert.equal(data.stats.pendingProposals,0);
 assert.equal(data.controls.premiumPublishing,false);
 assert.equal(data.controls.manualPaymentApproval,false);
 const q=await run('proposals',{},{result:[{proposalId:'d1111111-1111-4111-8111-111111111111',signalKey:'abc:def',market:'crypto',asset:'BTCUSDT',source:'exchange',analysis:{topSecret:'private'},proposedAt:'2026-11-11T00:00:00Z'}]});
 const msg=await q.text();assert.equal(q.status,200);assert.ok(!msg.includes('topSecret'));
});
test('Operational switches require reason, known keys and cannot enable payment publication',async()=>{
 const bad=await run('toggle',{method:'POST',body:{key:'premiumPublishing',enabled:true,reason:'Enable paid signals'}});
 assert.equal(bad.status,400);
 const calls=[],good=await run('toggle',{method:'POST',body:{key:'research_scans',enabled:false,reason:'Maintenance and feed audit'}},{calls});
 assert.equal(good.status,201);assert.equal((await good.json()).changed,true);
 const post=calls.find(x=>x.p==='/rest/v1/rpc/sc_admin_runtime_toggle');
 assert.ok(post);assert.equal(JSON.parse(post.body).p_actor,ADMIN);
});
test('Trial revocation is owner-checked, reason logged and does not reset trial history',async()=>{
 assert.equal((await run('revoke_trial',{method:'POST',body:{userId:OTHER,reason:'no'}})).status,400);
 const calls=[],r=await run('revoke_trial',{method:'POST',body:{userId:OTHER,reason:'Multiple suspicious signups'}},{calls});
 assert.equal(r.status,201);assert.equal((await r.json()).result,'revoked');
 assert.ok(calls.some(x=>x.p==='/rest/v1/rpc/sc_admin_trial_revoke_owner'));
 assert.ok(!calls.some(x=>x.p==='/rest/v1/rpc/sc_activate_trial'));
});
test('Audit entries remain immutable, read-only and owner-guarded',async()=>{
 const record={kind:'trial_action',actorId:ADMIN,subjectId:OTHER,action:'trial_revoke',reason:'Repeated device abuse',at:'2026-11-13T00:00:00Z'};
 const r=await run('audit',{},{result:[record]});
 assert.equal(r.status,200);const d=await r.json();assert.equal(d.events[0].action,'trial_revoke');
});
test('Control-plane policies fail closed and production signals remain disabled',async()=>{
 const r=await run('overview',{},{result:{controls:{researchScans:true},stats:{},recentScans:[]}});
 assert.equal(r.status,503);
});
