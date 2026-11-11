'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const modulePromise=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const UID='e29aafda-2cc8-4e11-a587-c983dd3f9113';
const TOKEN='jwt.payload.synthetic-token-for-tests-12345678901234567890';
const env={SUPABASE_URL:'https://qa-instance.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'};
const iso=new Date(Date.now()+7200000).toISOString();
function mock(calls){
 return async (url,options={})=>{
  const p=new URL(url).pathname;calls.push({p,options});
  const good=data=>new Response(JSON.stringify(data),{status:200});
  if(p==='/auth/v1/user')return good({id:UID,email:'qa@example.test',
   email_confirmed_at:'2026-11-11T00:00:00Z',created_at:'2026-11-11T00:00:00Z',
   user_metadata:{full_name:'Billing QA'}});
  if(p==='/rest/v1/sc_member_profiles')return good([{
   user_id:UID,email:'qa@example.test',display_name:'Billing QA',
   legacy_status:'unreconciled'}]);
  if(p==='/rest/v1/rpc/sc_trial_state')return good({
   trialStatus:'active',signalsUsed:1,signalsRemaining:2,
   activatedAt:'2026-11-11T00:00:00Z',expiresAt:iso});
  if(p==='/rest/v1/sc_paid_access')return good([]);
  throw Error('Unexpected remote call '+p);
 };
}
const req=(method='GET',action='me',auth=true)=>
 new Request('https://staging.example.test/api/cv-ops?action='+action,{
 method,headers:auth?{Authorization:'Bearer '+TOKEN}:{},
 body:method==='POST'?'{}':undefined
});
test('verified customer can see read-only membership with no wallet or fabricated payment history',async()=>{
 const {createWorker}=await modulePromise,calls=[];
 const response=await createWorker({fetchFn:mock(calls)}).fetch(req(),env);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.account.uid,UID);
 assert.equal(data.account.email,'qa@example.test');
 assert.equal(data.account.status,'trial');
 assert.equal(data.account.isAdmin,false);
 assert.equal(data.checkout.enabled,false);
 assert.equal(data.checkout.wallet,null);
 assert.deepEqual(data.payments,[]);
 assert.deepEqual(data.tickets,[]);
 assert.equal(data.migration.incomplete,true);
 assert.equal(data.migration.legacyHistoryPending,true);
 assert.ok(!JSON.stringify(data).includes('sb_secret'));
 assert.ok(calls.every(x=>['/auth/v1/user','/rest/v1/sc_member_profiles',
  '/rest/v1/rpc/sc_trial_state','/rest/v1/sc_paid_access'].includes(x.p)));
});
test('billing read denies anonymous requests',async()=>{
 const {createWorker}=await modulePromise,calls=[];
 const response=await createWorker({fetchFn:mock(calls)}).fetch(req('GET','me',false),env);
 assert.equal(response.status,401);
 assert.equal(calls.length,0);
});
test('billing submission, administrative review, ticket writes and receipt reads fail closed',async()=>{
 const {createWorker}=await modulePromise,calls=[];
 const worker=createWorker({fetchFn:mock(calls)});
 for(const [method,action] of [['POST','submit_payment'],['POST','review_payment'],
  ['GET','admin'],['GET','receipt'],['POST','new_ticket'],['POST','reply'],['GET','messages']]){
  const response=await worker.fetch(req(method,action),env);
  assert.equal(response.status,503,action);
 }
 assert.equal(calls.length,0);
});
test('disabled billing HTML never displays a receiving wallet by default',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../billing.html'),'utf8');
 const wallet=html.match(/<section class="cand-glass cand-card" hidden><div class="cand-panel-title"><strong>Bitcoin receiving wallet/);
 assert.ok(wallet,'wallet container must start hidden');
 assert.match(html,/id="cand-wallet">—<\/span>/);
 assert.doesNotMatch(html,/id="cand-wallet">bc1/);
 assert.match(html,/Do not transfer funds unless SignalChart provides an active, verified invoice/);
});
test('frontend does not draw QR or quote when checkout is disabled',()=>{
 const script=fs.readFileSync(path.resolve(__dirname,'../site-app.js'),'utf8');
 assert.match(script,/if\(c\.enabled&&c\.wallet!==WALLET\)/);
 assert.match(script,/walletSection\.hidden=!c\.enabled/);
 assert.match(script,/txt\('#cand-wallet',c\.enabled\?c\.wallet:'—'\)/);
 assert.match(script,/if\(userData\?\.checkout\?\.enabled\)\{/);
 assert.match(script,/userData\.migration\?\.incomplete/);
});
