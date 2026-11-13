'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const mod=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const ADMIN='b1111111-1111-4111-8111-111111111111',MEMBER='c1111111-1111-4111-8111-111111111111';
const TOKEN='jwt.valid.verified-token-for-cloudflare-tests-1234567890';
const env={SUPABASE_URL:'https://test-admin-ops.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',SC_ADMIN_OWNER_DB_ENABLED:'true',
 SC_ADMIN_OPS_READ_ENABLED:'true',SC_ADMIN_PAYMENT_REVIEW_ENABLED:'false',
 SC_ADMIN_COMPLIMENTARY_WRITE_ENABLED:'true'};
const ok=x=>Response.json(x);
function stub({owner=ADMIN,user=ADMIN,rows=[],grants=[],payments=[],result=null}={}){
 return async(u,o)=>{
  const url=new URL(u),p=url.pathname;
  rows.push({p,method:o.method,body:o.body});
  if(p==='/auth/v1/user')return o.headers.Authorization==='Bearer '+TOKEN?
   ok({id:user,email:'owner@signalchart.test',email_confirmed_at:'2026-11-12T12:00:00Z'}):new Response('denied',{status:401});
  if(p==='/rest/v1/sc_admin_owner')return ok(owner?[{user_id:owner}]:[]);
  if(p==='/rest/v1/rpc/sc_admin_payment_queue')return ok(payments);
  if(p==='/rest/v1/rpc/sc_admin_member_search')return ok([{userId:MEMBER,email:'customer@test.invalid',name:'Customer',joinedAt:'2026-11-12T12:00:00Z',legacyStatus:'reviewed'}]);
  if(p==='/rest/v1/rpc/sc_admin_member_grants')return ok(grants);
  if(p==='/rest/v1/rpc/sc_admin_access_grant')return ok(result||{recorded:true,grantId:'d1111111-1111-4111-8111-111111111111',expiresAt:'2026-12-01T00:00:00Z'});
  if(p==='/rest/v1/rpc/sc_admin_access_revoke')return ok(result||{recorded:true,revoked:true});
  if(p==='/rest/v1/rpc/sc_admin_payment_review')return ok(result||{recorded:true,eventId:'e1111111-1111-4111-8111-111111111111'});
  throw Error('Unexpected private upstream path '+p);
 };
}
const request=(path,{method='GET',auth=true,body}={})=>new Request('https://staging.test'+path,{
 method,headers:{...(auth?{Authorization:'Bearer '+TOKEN}:{}),...(body?{'Content-Type':'application/json'}:{})},
 body:body?JSON.stringify(body):undefined
});
async function run(path,options={},config=env,upstream=stub()){return (await mod).createWorker({fetchFn:upstream}).fetch(request(path,options),config)}
test('Anonymous and ordinary member cannot read private payment queue or member search',async()=>{
 for(const url of ['/api/admin-payments','/api/admin-members?q=cus']){
  assert.equal((await run(url,{auth:false})).status,401);
  assert.equal((await run(url,{},env,stub({owner:MEMBER}))).status,403);
 }
});
test('Customer metadata does not confer private access and database owner check is mandatory',async()=>{
 const rows=[],requester=stub({owner:null,rows});
 assert.equal((await run('/api/admin-payments',{},env,requester)).status,403);
 assert.ok(!rows.some(x=>x.p==='/rest/v1/rpc/sc_admin_payment_queue'));
});
test('Empty SQL queue and verified customer search return only allowlisted fields',async()=>{
 const p=await run('/api/admin-payments');
 assert.equal(p.status,200);const queue=await p.json();
 assert.deepEqual(queue.payments,[]);assert.equal(queue.capabilities.canApprove,false);
 assert.equal(queue.capabilities.customerCheckout,false);
 const m=await run('/api/admin-members?q=cus');
 assert.equal(m.status,200);const members=await m.json();
 assert.equal(members.members.length,1);assert.deepEqual(Object.keys(members.members[0]).sort(),['email','joinedAt','legacyStatus','name','userId'].sort());
});
test('Private payment approval cannot be sent while review flag is off or turned on',async()=>{
 const p={paymentId:'d1111111-1111-4111-8111-111111111111',action:'approve',reason:'Unverified payment review'};
 assert.equal((await run('/api/admin-payments?action=review',{method:'POST',body:p})).status,503);
 const active={...env,SC_ADMIN_PAYMENT_REVIEW_ENABLED:'true'};
 const rows=[];const res=await run('/api/admin-payments?action=review',{method:'POST',body:p},active,stub({rows}));
 assert.equal(res.status,400);assert.ok(!rows.some(x=>x.p==='/rest/v1/rpc/sc_admin_payment_review'));
});
test('Staging complimentary grant is audited through owner-only RPC, never paid-access insert',async()=>{
 const rows=[],body={userId:MEMBER,reason:'Founder-approved trial extension',expiresAt:new Date(Date.now()+7*86400000).toISOString()};
 const res=await run('/api/admin-members?action=grant',{method:'POST',body},env,stub({rows}));
 assert.equal(res.status,201);assert.equal((await res.json()).recorded,true);
 const write=rows.find(x=>x.p==='/rest/v1/rpc/sc_admin_access_grant');assert.ok(write);
 const payload=JSON.parse(write.body);
 assert.equal(payload.p_actor,ADMIN);assert.equal(payload.p_user,MEMBER);
 assert.ok(!rows.some(x=>x.p==='/rest/v1/sc_paid_access'));
});
test('Revoke requires reason and uses immutable revoke RPC, never edits paid subscription',async()=>{
 const bad=await run('/api/admin-members?action=revoke',{method:'POST',body:{grantId:'d1111111-1111-4111-8111-111111111111',reason:'ok'}});
 assert.equal(bad.status,400);
 const rows=[];
 const good=await run('/api/admin-members?action=revoke',{method:'POST',body:{grantId:'d1111111-1111-4111-8111-111111111111',reason:'Approved support request'}},env,stub({rows}));
 assert.equal(good.status,201);assert.ok(rows.some(x=>x.p==='/rest/v1/rpc/sc_admin_access_revoke'));
});
test('Unknown extra fields cannot smuggle privileged actor or approval flags',async()=>{
 const body={userId:MEMBER,reason:'Support complimentary upgrade',expiresAt:new Date(Date.now()+86400000).toISOString(),verifiedOnChain:true};
 const rows=[];
 assert.equal((await run('/api/admin-members?action=grant',{method:'POST',body},env,stub({rows}))).status,400);
 assert.ok(!rows.some(x=>x.p==='/rest/v1/rpc/sc_admin_access_grant'));
});
test('Production live paid checkout remains disabled; staging flags do not open billing',()=>{
 const cfg=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../cloudflare/wrangler.staging.json'),'utf8'));
 assert.equal(cfg.vars.SC_AUTO_PUBLISH_ENABLED,'false');
 assert.equal(cfg.vars.SC_ADMIN_PAYMENT_REVIEW_ENABLED,'false');
 assert.equal(cfg.vars.SC_ADMIN_COMPLIMENTARY_WRITE_ENABLED,'true');
});
