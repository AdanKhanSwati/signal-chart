'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const modulePromise=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const ADMIN='b1111111-1111-4111-8111-111111111111',OTHER='c1111111-1111-4111-8111-111111111111';
const TOKEN='jwt.test.bearer.token.enough-characters-to-validate-123456789';
const env={SUPABASE_URL:'https://overview-test.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SC_ADMIN_OWNER_DB_ENABLED:'true'};
const req=(authorized=true,method='GET')=>new Request('https://staging.example.test/api/admin-overview',{
 method,headers:authorized?{Authorization:'Bearer '+TOKEN}:{}
});
const ok=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
function upstream({who=ADMIN,owner=ADMIN,data=null,rows=[],fail=null}={}){
 return async(url,opts)=>{
  const u=new URL(url);rows.push({path:u.pathname,method:opts.method,body:opts.body,headers:opts.headers});
  if(u.pathname===fail)return new Response('failure',{status:500});
  if(u.pathname==='/auth/v1/user')return opts.headers.Authorization==='Bearer '+TOKEN?
   ok({id:who,email:'verified@example.test',email_confirmed_at:'2026-11-11T00:00:00Z'}):
   new Response('unauthorized',{status:401});
  if(u.pathname==='/rest/v1/sc_admin_owner')return ok([{user_id:owner}]);
  if(u.pathname==='/rest/v1/rpc/sc_admin_overview')return ok(data||{
   registeredUsers:17,openTickets:3,resolvedTickets:6,activePaidAccess:4,unreconciledAccounts:2,lastTicketAt:null
  });
  throw Error('Unexpected upstream request '+u.pathname);
 };
}
test('Overview rejects anonymous requests and non-admin users before private metrics read',async()=>{
 const {createWorker}=await modulePromise;
 for(const [signed,who,status] of [[false,ADMIN,401],[true,OTHER,403]]){
  const rows=[],w=createWorker({fetchFn:upstream({who,rows})});
  const r=await w.fetch(req(signed),env);assert.equal(r.status,status);
  assert.equal(rows.some(x=>x.path.includes('sc_admin_overview')),false);
 }
});
test('Verified super admin receives accurate bounded overview and no private customer records',async()=>{
 const {createWorker}=await modulePromise,rows=[];
 const w=createWorker({fetchFn:upstream({rows})}),r=await w.fetch(req(),env);
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.overview.registeredUsers,17);
 assert.equal(data.overview.openTickets,3);
 assert.equal(data.overview.activePaidAccess,4);
 assert.equal(data.capabilities.paymentReview,false);
 assert.equal(data.capabilities.remotePush,false);
 assert.equal(typeof data.asOf,'string');
 assert.match(r.headers.get('Cache-Control'),/no-store/);
 assert.equal(rows.find(x=>x.path.includes('sc_admin_overview')).method,'POST');
 assert.equal(rows.find(x=>x.path.includes('sc_admin_overview')).headers.apikey,env.SUPABASE_SECRET_KEY);
 assert.doesNotMatch(JSON.stringify(data),/email|user_id|sb_secret/);
});
test('Invalid or failed overview never fabricates zero counts',async()=>{
 const {createWorker}=await modulePromise;
 for(const data of [{registeredUsers:'14',openTickets:0,resolvedTickets:0,activePaidAccess:0,unreconciledAccounts:0,lastTicketAt:null},
  {registeredUsers:-1,openTickets:0,resolvedTickets:0,activePaidAccess:0,unreconciledAccounts:0,lastTicketAt:null},
  {registeredUsers:0,openTickets:0,resolvedTickets:0,activePaidAccess:0,unreconciledAccounts:0,lastTicketAt:'not-a-date'}]){
  const r=await createWorker({fetchFn:upstream({data})}).fetch(req(),env);
  assert.equal(r.status,503);
 }
 const failed=await createWorker({fetchFn:upstream({fail:'/rest/v1/rpc/sc_admin_overview'})}).fetch(req(),env);
 assert.equal(failed.status,503);
});
test('Only GET reads overview, no mutation route exposed',async()=>{
 const {createWorker}=await modulePromise,rows=[];
 const r=await createWorker({fetchFn:upstream({rows})}).fetch(req(true,'POST'),env);
 assert.equal(r.status,405);assert.equal(rows.length,0);
});
