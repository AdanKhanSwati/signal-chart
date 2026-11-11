'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const workerPromise=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);

const ADMIN='e29aafda-2cc8-4e11-a587-c983dd3f9113';
const OTHER='fe13386e-c87a-4f15-92dd-4c1ebff476e1';
const ITEM='569b94a7-d926-4ccb-896f-9d16c405fabb';
const TOKEN='verified.test.supabase-session-01234567890123456789';
const env={
 SUPABASE_URL:'https://test-instance.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SC_SUPER_ADMIN_UID:ADMIN
};
const auth={id:ADMIN,email:'reviewer@example.test',
 email_confirmed_at:'2026-11-11T00:00:00Z',
 user_metadata:{role:'customer',isAdmin:false}};
const ok=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
function upstream({calls=[],user=auth,result={
 status:'noted',reviewStatus:'needs_manual_review',
 accessGranted:false,paymentVerified:false
},fail=false}={}){
 return async(url,options={})=>{
  const route=new URL(url).pathname;
  calls.push({route,options});
  if(route==='/auth/v1/user'){
   if(options.headers?.Authorization!=='Bearer '+TOKEN)
    return new Response('Denied',{status:401});
   return ok(user);
  }
  if(route==='/rest/v1/rpc/sc_recovery_add_review_note')
   return fail?new Response('Failure',{status:503}):ok(result);
  throw Error('Unexpected external path: '+route);
 };
}
const req=(body,{action='note',method='POST',authorized=true,contentType='application/json'}={})=>{
 const headers={};
 if(authorized)headers.Authorization='Bearer '+TOKEN;
 if(method==='POST')headers['Content-Type']=contentType;
 return new Request('https://sc-staging.example.test/api/recovery?action='+action,{
  method,headers,body:method==='POST'?JSON.stringify(body):undefined
 });
};
async function worker(fetchFn){return (await workerPromise).createWorker({fetchFn})}
test('Verified configured admin writes an append-only review note, without any grants',async()=>{
 const calls=[],w=await worker(upstream({calls}));
 const res=await w.fetch(req({itemId:ITEM,note:'Need original Vercel invoice and transaction record.'}),env);
 assert.equal(res.status,200);
 const body=await res.json();
 assert.deepEqual(body,{status:'noted',reviewStatus:'needs_manual_review',
  entitlementChanged:false,paymentApproved:false});
 const rpc=calls.find(x=>x.route==='/rest/v1/rpc/sc_recovery_add_review_note');
 assert.ok(rpc);
 assert.deepEqual(JSON.parse(rpc.options.body),{
  p_actor:ADMIN,p_item:ITEM,
  p_note:'Need original Vercel invoice and transaction record.'
 });
 assert.equal(rpc.options.headers.apikey,env.SUPABASE_SECRET_KEY);
 assert.equal(rpc.options.headers.Authorization,undefined);
 assert.equal(calls.filter(x=>x.route.startsWith('/rest/v1/')).length,1);
 assert.ok(!JSON.stringify(body).includes('invoice'));
});
test('Forged metadata superadmin and forged request actor cannot authorize review writes',async()=>{
 const calls=[],w=await worker(upstream({calls,user:{
  ...auth,id:OTHER,user_metadata:{isAdmin:true,role:'super_admin'},
  app_metadata:{role:'super_admin'}
 }}));
 const res=await w.fetch(req({itemId:ITEM,uid:ADMIN,isAdmin:true,
  note:'Attempt to mark my transaction as approved.'}),env);
 assert.equal(res.status,403);
 assert.equal(calls.some(x=>x.route.includes('rpc/sc_recovery')),false);
});
test('Missing server-configured admin denies review even if bearer verified',async()=>{
 const calls=[],w=await worker(upstream({calls}));
 const res=await w.fetch(req({itemId:ITEM,note:'Check evidence.'}),{
  ...env,SC_SUPER_ADMIN_UID:''
 });
 assert.equal(res.status,503);
 assert.equal(calls.some(x=>x.route.includes('rpc/sc_recovery')),false);
});
test('Anonymous and unverified sessions cannot create audit events',async()=>{
 const calls=[],w=await worker(upstream({calls}));
 const a=await w.fetch(req({itemId:ITEM,note:'A new review note'},{
  authorized:false
 }),env);
 assert.equal(a.status,401);
 assert.equal(calls.length,0);
 const calls2=[],no=await worker(upstream({calls:calls2,user:{
  ...auth,email_confirmed_at:null
 }}));
 const b=await no.fetch(req({itemId:ITEM,note:'A new review note'}),env);
 assert.equal(b.status,401);
 assert.equal(calls2.some(x=>x.route.includes('rpc/sc_recovery')),false);
});
test('Missing or invalid IDs and short review notes fail before database writes',async()=>{
 const calls=[],w=await worker(upstream({calls}));
 const invalid=[
  {itemId:'../../secret',note:'Check invoice'},
  {itemId:'x',note:'Check invoice'},
  {itemId:ITEM,note:'ok'},
  {itemId:ITEM,note:'x'.repeat(1201)},
  {itemId:ITEM,note:null},
  {itemId:null,note:'Check invoice'}
 ];
 for(const body of invalid){
  const result=await w.fetch(req(body),env);
  assert.equal(result.status,400);
 }
 assert.equal(calls.some(x=>x.route.includes('rpc/sc_recovery')),false);
});
test('Missing JSON content-type is rejected without audit write',async()=>{
 const calls=[],w=await worker(upstream({calls}));
 const res=await w.fetch(req({itemId:ITEM,note:'Check invoice'},{contentType:'text/plain'}),env);
 assert.equal(res.status,415);
 assert.equal(calls.some(x=>x.route.includes('rpc/sc_recovery')),false);
});
test('Already reviewed items cannot be silently reopened by review note',async()=>{
 const w=await worker(upstream({result:{status:'review_locked'}}));
 const res=await w.fetch(req({itemId:ITEM,note:'Review after reconciliation'}),env);
 assert.equal(res.status,409);
});
test('Not-found, rate-limited and unexpectedly successful audit responses fail closed',async()=>{
 for(const [result,status]of [
  [{status:'not_found'},404],
  [{status:'rate_limited'},429],
  [{status:'noted',reviewStatus:'needs_manual_review',
   accessGranted:true,paymentVerified:false},503],
  [{status:'noted',reviewStatus:'needs_manual_review',
   accessGranted:false,paymentVerified:true},503]
 ]){
  const w=await worker(upstream({result}));
  const res=await w.fetch(req({itemId:ITEM,note:'Investigate this evidence'}),env);
  assert.equal(res.status,status);
 }
});
test('Provider errors and other recovery actions never write evidence notes',async()=>{
 const w=await worker(upstream({fail:true}));
 assert.equal((await w.fetch(req({itemId:ITEM,note:'Investigate this evidence'}),env)).status,503);
 const calls=[],other=await worker(upstream({calls}));
 assert.equal((await other.fetch(req({}, {action:'approve'}),env)).status,405);
 assert.equal(calls.length,0);
});
