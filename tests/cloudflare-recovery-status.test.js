'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const workerPromise=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);

const UID='e29aafda-2cc8-4e11-a587-c983dd3f9113';
const OTHER='ba970b91-2c99-4a3b-8226-77f943824f39';
const ITEM='569b94a7-d926-4ccb-896f-9d16c405fabb';
const TOKEN='synthetic.test.jwt-auth-with-enough-characters-for-validation';
const env={
 SUPABASE_URL:'https://qa-instance.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SC_SUPER_ADMIN_UID:UID
};
const user={id:UID,email:'qa@example.test',email_confirmed_at:'2026-11-11T01:00:00Z',
 user_metadata:{role:'customer'},created_at:'2026-11-11T00:00:00Z'};
const request=(action='status',{method='GET',signed=true}={})=>
 new Request('https://staging.workers.dev/api/recovery?action='+action,{
  method,headers:signed?{Authorization:'Bearer '+TOKEN}:{}
 });
const ok=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
function simulate({requests=[],identity=user,records=[],errorPath=null}={}){
 return async (url,options={})=>{
  const pathname=new URL(url).pathname;
  requests.push({pathname,options});
  if(errorPath===pathname)return new Response('Error',{status:500});
  if(pathname==='/auth/v1/user'){
   if(options.headers.Authorization!=='Bearer '+TOKEN)
    return new Response('Unauthorized',{status:401});
   return ok(identity);
  }
  if(pathname==='/rest/v1/sc_legacy_recovery_items')return ok(records);
  throw Error('Unexpected upstream '+pathname);
 };
}
const worker=async fetchFn=>(await workerPromise).createWorker({fetchFn});
test('Recovery status returns not-imported rather than pretending missing historical objects',async()=>{
 const calls=[],w=await worker(simulate({requests:calls}));
 const res=await w.fetch(request(),env);
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.status,'inventory_not_imported');
 assert.equal(data.inventoryCount,0);
 assert.equal(data.verifiedReadCount,0);
 assert.equal(data.entitlementChangesMade,false);
 assert.equal(data.paymentsEnabled,false);
 assert.match(data.note,/never authorize access/i);
 assert.equal(calls.filter(x=>x.pathname==='/rest/v1/sc_legacy_recovery_items').length,1);
});
test('Recovery counts are privacy-preserving even if stored rows contain private hints',async()=>{
 const records=[
  {id:ITEM,item_kind:'member',retrieval_status:'inventory_only',review_status:'pending',
   source_key:'private/member-with-email@example.test',user_id_hint:OTHER},
  {id:OTHER,item_kind:'payment',retrieval_status:'verified_read',review_status:'needs_manual_review',
   content_sha256:'a'.repeat(64),private_evidence_path:'private/payments/receipt.png'},
  {id:UID,item_kind:'audit',retrieval_status:'not_accessible',review_status:'pending'}
 ];
 const w=await worker(simulate({records}));
 const res=await w.fetch(request(),env);
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.status,'reconciliation_pending');
 assert.equal(data.inventoryCount,3);
 assert.equal(data.verifiedReadCount,1);
 assert.equal(data.inaccessibleCount,1);
 assert.equal(data.awaitingReviewCount,3);
 assert.equal(data.categories.member,1);
 assert.equal(data.categories.payment,1);
 assert.equal(data.categories.audit,1);
 const raw=JSON.stringify(data);
 assert.ok(!raw.includes('private/'));
 assert.ok(!raw.includes('example.test'));
 assert.ok(!raw.includes(OTHER));
 assert.ok(!raw.includes('a'.repeat(64)));
});
test('Verified non-administrator cannot read any recovery metadata',async()=>{
 const calls=[],w=await worker(simulate({requests:calls,identity:{
  ...user,id:OTHER,user_metadata:{role:'super_admin'},app_metadata:{role:'admin'}
 }}));
 const res=await w.fetch(request(),env);
 assert.equal(res.status,403);
 assert.equal(calls.some(x=>x.pathname==='/rest/v1/sc_legacy_recovery_items'),false);
});
test('Missing server-only admin UUID fails closed without accessing evidence',async()=>{
 const calls=[],w=await worker(simulate({requests:calls}));
 const res=await w.fetch(request(),{...env,SC_SUPER_ADMIN_UID:''});
 assert.equal(res.status,503);
 assert.equal(calls.some(x=>x.pathname==='/rest/v1/sc_legacy_recovery_items'),false);
});
test('Recovery API denies anonymous sessions before database access',async()=>{
 const calls=[],w=await worker(simulate({requests:calls}));
 const res=await w.fetch(request('status',{signed:false}),env);
 assert.equal(res.status,401);
 assert.equal(calls.length,0);
});
test('Recovery API rejects all write requests and unrecognised actions',async()=>{
 const calls=[],w=await worker(simulate({requests:calls}));
 for(const req of [request('status',{method:'POST'}),request('import'),request('approve')]){
  const res=await w.fetch(req,env);
  assert.equal(res.status,405);
 }
 assert.equal(calls.length,0);
});
test('Unknown categories and false reconciliation state fail closed',async()=>{
 for(const row of [
  {id:ITEM,item_kind:'unknown-bucket',review_status:'pending',retrieval_status:'inventory_only'},
  {id:ITEM,item_kind:'payment',review_status:'reconciled',retrieval_status:'inventory_only'},
  {id:ITEM,item_kind:'payment',review_status:'reconciled',retrieval_status:'verified_read',
   content_sha256:null}
 ]){
  const w=await worker(simulate({records:[row]}));
  const res=await w.fetch(request(),env);
  assert.equal(res.status,503);
 }
});
test('Unverified email session and upstream data errors cannot expose inventory',async()=>{
 const pending=await worker(simulate({identity:{...user,email_confirmed_at:null}}));
 assert.equal((await pending.fetch(request(),env)).status,401);
 const blocked=await worker(simulate({errorPath:'/rest/v1/sc_legacy_recovery_items'}));
 assert.equal((await blocked.fetch(request(),env)).status,503);
});
test('Inventory pagination is bounded; counts never pretend to cover an incomplete sample',async()=>{
 const records=Array.from({length:1001},(_,i)=>({
  id:'569b94a7-d926-4ccb-896f-'+String(i).padStart(12,'0'),
  item_kind:'unknown',retrieval_status:'inventory_only',review_status:'pending'
 }));
 const w=await worker(simulate({records}));
 const res=await w.fetch(request(),env);
 assert.equal(res.status,503);
});

test('All reviewed rows still cannot certify source inventory completeness',async()=>{
 const records=[{
  id:ITEM,item_kind:'payment',retrieval_status:'verified_read',
  review_status:'reconciled',content_sha256:'f'.repeat(64)
 }];
 const w=await worker(simulate({records}));
 const res=await w.fetch(request(),env);
 assert.equal(res.status,200);
 const state=await res.json();
 assert.equal(state.manuallyReconciledCount,1);
 assert.equal(state.awaitingReviewCount,0);
 assert.equal(state.sourceInventoryCompletenessVerified,false);
 assert.equal(state.status,'items_reviewed_source_completeness_unverified');
 assert.equal(state.entitlementChangesMade,false);
});
