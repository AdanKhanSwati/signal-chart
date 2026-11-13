'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const workerImport=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const UID='e14c77cb-5792-4ebf-a16c-e6186fe28cb0',OTHER='77777777-7777-4777-8777-777777777777';
const TOKEN='jwt.admin.token.valid-12345678901234567890';
const env={SUPABASE_URL:'https://test-owner.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',SC_ADMIN_OWNER_DB_ENABLED:'true',SC_SUPER_ADMIN_UID:OTHER};
function fake({owner=UID,identity=UID,requests=[]}={}){
 return async (url,opts)=>{
  const p=new URL(url).pathname;requests.push({p,auth:opts.headers?.Authorization});
  if(p==='/auth/v1/user')return new Response(JSON.stringify({id:identity,email:'admin@example.test',email_confirmed_at:'2026-11-11T00:00:00Z'}),{status:opts.headers.Authorization==='Bearer '+TOKEN?200:401,headers:{'Content-Type':'application/json'}});
  if(p==='/rest/v1/sc_admin_owner')return Response.json(owner?[{user_id:owner}]:[]);
  throw Error('Unexpected upstream path: '+p);
 }
}
const req=(auth=true)=>new Request('https://staging.example.test/api/admin-session',{headers:auth?{Authorization:'Bearer '+TOKEN}:{}});
test('Single-owner database gate grants only the verified owner regardless of stale environment admin UID',async()=>{
 const {createWorker}=await workerImport;
 const calls=[];const w=createWorker({fetchFn:fake({requests:calls})});
 const ok=await w.fetch(req(),env);
 assert.equal(ok.status,200);assert.equal((await ok.json()).authorized,true);
 assert.equal(calls.filter(x=>x.p==='/rest/v1/sc_admin_owner').length,1);
 assert.ok(calls.every(x=>x.p!=='/rest/v1/sc_member_profiles'));
});
test('Stale environment administrator UID and client metadata cannot override DB owner',async()=>{
 const {createWorker}=await workerImport;
 for(const owner of [null,OTHER]){
  const w=createWorker({fetchFn:fake({owner})});
  assert.equal((await w.fetch(req(),env)).status,403);
 }
 const wrong=createWorker({fetchFn:fake({owner:UID,identity:OTHER})});
 assert.equal((await wrong.fetch(req(),env)).status,403);
 assert.equal((await wrong.fetch(req(false),env)).status,401);
});
test('Missing or malformed private owner directory fails closed',async()=>{
 const {createWorker}=await workerImport;
 const stub=async(url,opts)=>new URL(url).pathname==='/auth/v1/user'?
 Response.json({id:UID,email:'owner@example.test',email_confirmed_at:'2026-11-11T00:00:00Z'}):Response.json([{user_id:UID},{user_id:OTHER}]);
 assert.equal((await createWorker({fetchFn:stub}).fetch(req(),env)).status,503);
});
test('Cloudflare staging explicitly uses private Supabase single-owner authorization',()=>{
 const fs=require('node:fs');
 const cfg=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../cloudflare/wrangler.staging.json'),'utf8'));
 assert.equal(cfg.vars.SC_ADMIN_OWNER_DB_ENABLED,'true');
 assert.equal(cfg.vars.SC_AUTO_PUBLISH_ENABLED,'false');
});
