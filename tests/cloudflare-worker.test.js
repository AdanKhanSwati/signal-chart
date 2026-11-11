'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const workerImport=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const uid='e29aafda-2cc8-4e11-a587-c983dd3f9113';
const other='8a6f40dc-5b08-40c7-91e6-e6349c4c2609';
const token='jwt.payload.signature-12345678901234567890';
const env={
 SUPABASE_URL:'https://test-instance.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 ASSETS:{fetch:async request=>new Response('ASSET:'+new URL(request.url).pathname)}
};
const user={id:uid,email:'member@example.test',email_confirmed_at:'2026-11-10T10:00:00Z',user_metadata:{full_name:'Member QA',role:'admin'}};
const profile={user_id:uid,email:'member@example.test',display_name:'Member QA',legacy_status:'unreconciled',created_at:'2026-11-10T10:00:00Z',updated_at:'2026-11-10T10:00:00Z'};
const trial={trialStatus:'active',signalsRemaining:2,signalsUsed:1,activatedAt:new Date(Date.now()-3600000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()};
const ok=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const get=(path,auth=true)=>new Request('https://staging.example.test'+path,{headers:auth?{Authorization:'Bearer '+token}:{}});
function stub({profileRows=[profile],trialData=trial,paidRows=[],authUser=user,failPath='',collect=[]}={}){
 let created=null;
 return async (u,options={})=>{
  const url=new URL(u);
  collect.push({pathname:url.pathname,search:url.search,method:options.method,headers:options.headers,body:options.body});
  if(failPath&&url.pathname===failPath)return new Response('fail',{status:503});
  if(url.pathname==='/auth/v1/user'){
   if(!options.headers.Authorization?.includes(token))return new Response('not found',{status:401});
   return ok(authUser);
  }
  if(url.pathname==='/rest/v1/sc_member_profiles'){
   if(options.method==='POST'){
    created=JSON.parse(options.body);
    return ok([{...created,legacy_status:'unreconciled'}]);
   }
   return ok(created?[{...created,legacy_status:'unreconciled'}]:profileRows);
  }
  if(url.pathname==='/rest/v1/rpc/sc_trial_state')return ok(trialData);
  if(url.pathname==='/rest/v1/sc_paid_access')return ok(paidRows);
  throw Error('unexpected upstream path: '+url.pathname);
 };
}
test('Cloudflare static assets fall through without executing server APIs',async()=>{
 const {createWorker}=await workerImport;
 const res=await createWorker({fetchFn:async()=>{throw Error('network must not be used')}}).fetch(get('/index.html',false),env);
 assert.equal(await res.text(),'ASSET:/index.html');
});
test('public configuration keeps payment and signal activation disabled',async()=>{
 const {createWorker}=await workerImport;
 const res=await createWorker({fetchFn:stub()}).fetch(get('/api/config',false),env);
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.authReady,true);
 assert.equal(data.paymentsEnabled,false);
 assert.equal(data.signalsEnabled,false);
 assert.equal(data.emailDeviceTrialEnabled,false);
 assert.equal(data.supabaseAnonKey,env.SUPABASE_PUBLISHABLE_KEY);
 assert.ok(!JSON.stringify(data).includes(env.SUPABASE_SECRET_KEY));
 assert.equal(res.headers.get('Cache-Control'),'private, no-store, max-age=0');
});
test('unmigrated routes fail closed without reaching privileged Supabase',async()=>{
 const {createWorker}=await workerImport;
 const calls=[];
 const w=createWorker({fetchFn:stub({collect:calls})});
 const res=await w.fetch(get('/api/cv-ops?action=review',false),env);
 assert.equal(res.status,503);assert.equal(calls.length,0);
 const pay=await w.fetch(new Request('https://staging.example.test/api/member?action=pay',{method:'POST'}),env);
 assert.equal(pay.status,503);assert.equal(calls.length,0);
});
test('member and trial routes require a bearer session',async()=>{
 const {createWorker}=await workerImport;
 const calls=[];
 const w=createWorker({fetchFn:stub({collect:calls})});
 for(const path of ['/api/member?action=me','/api/trial?action=state']){
  const result=await w.fetch(get(path,false),env);
  assert.equal(result.status,401);
 }
 assert.equal(calls.length,0);
});
test('verified member state uses Supabase auth UID and isolates privileged queries',async()=>{
 const {createWorker}=await workerImport;
 const calls=[];
 const w=createWorker({fetchFn:stub({collect:calls})});
 const response=await w.fetch(get('/api/member?action=me&uid='+other),env);
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.account.uid,uid);
 assert.equal(result.account.email,user.email);
 assert.equal(result.account.status,'trial');
 assert.equal(result.account.access,true);
 assert.equal(result.account.isAdmin,false);
 assert.equal(result.account.legacyRecoveryPending,true);
 assert.equal(result.payment.enabled,false);
 assert.deepEqual(result.requests,[]);
 assert.equal(result.migration.incomplete,true);
 const selects=calls.filter(x=>x.search.includes('user_id=eq.'));
 assert.equal(selects.length,2);
 assert.ok(selects.every(x=>x.search.includes(uid)));
 assert.ok(selects.every(x=>!x.search.includes(other)));
 assert.equal(calls.find(x=>x.pathname==='/rest/v1/rpc/sc_trial_state').body,JSON.stringify({p_user:uid}));
 assert.ok(calls.every(x=>!JSON.stringify(x).includes('service_role')));
 assert.ok(!JSON.stringify(result).includes(env.SUPABASE_SECRET_KEY));
});
test('verified paid SQL entitlement, never user metadata or request, may grant paid status',async()=>{
 const {createWorker}=await workerImport;
 const active={user_id:uid,source:'verified_crypto_payment',starts_at:new Date(Date.now()-60000).toISOString(),
  expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null};
 const res=await createWorker({fetchFn:stub({paidRows:[active]})}).fetch(get('/api/member?action=me&isAdmin=true'),env);
 assert.equal(res.status,200);const data=await res.json();
 assert.equal(data.account.status,'active');
 assert.equal(data.account.access,true);
 assert.equal(data.account.isAdmin,false);
 assert.equal(data.account.paidUntil,active.expires_at);
});
test('unverified email cannot read member or trial state',async()=>{
 const {createWorker}=await workerImport;
 const calls=[];
 const res=await createWorker({fetchFn:stub({authUser:{...user,email_confirmed_at:null},collect:calls})}).fetch(get('/api/member?action=me'),env);
 assert.equal(res.status,401);
 assert.equal(calls.length,1);
});
test('wrong-user paid row fails closed without showing premium membership',async()=>{
 const {createWorker}=await workerImport;
 const paid={user_id:other,source:'verified_crypto_payment',starts_at:new Date(Date.now()-6000).toISOString(),
  expires_at:new Date(Date.now()+86400000).toISOString(),revoked_at:null};
 const res=await createWorker({fetchFn:stub({paidRows:[paid]})}).fetch(get('/api/member?action=me'),env);
 assert.equal(res.status,503);
});
test('rejected, expired and revoked SQL grants do not unlock paid access',async()=>{
 const {createWorker}=await workerImport;
 const expires=new Date(Date.now()-60000).toISOString();
 const rows=[{user_id:uid,source:'verified_crypto_payment',starts_at:new Date(Date.now()-86400000).toISOString(),expires_at:expires,revoked_at:null},
 {user_id:uid,source:'verified_crypto_payment',starts_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),revoked_at:new Date().toISOString()},
 {user_id:uid,source:'pending_payment',starts_at:new Date(Date.now()-60000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),revoked_at:null}];
 const res=await createWorker({fetchFn:stub({trialData:{...trial,trialStatus:'expired',expiresAt:expires},paidRows:rows})}).fetch(get('/api/member?action=me'),env);
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.account.status,'locked');
 assert.equal(data.account.access,false);
});
test('trial state endpoint uses verified UID and includes server timestamp',async()=>{
 const {createWorker}=await workerImport;
 const calls=[];
 const res=await createWorker({fetchFn:stub({collect:calls})}).fetch(get('/api/trial?action=state'),env);
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.trialStatus,'active');
 assert.ok(Date.parse(data.serverNow));
 assert.equal(calls.filter(x=>x.pathname.includes('sc_member_profiles')).length,0);
});
test('login-created profile cannot inject admin, paid or trial fields',async()=>{
 const {createWorker}=await workerImport;
 const calls=[];
 const res=await createWorker({fetchFn:stub({profileRows:[],collect:calls})}).fetch(get('/api/member?action=me'),env);
 assert.equal(res.status,200);
 const insert=calls.find(x=>x.method==='POST'&&x.pathname==='/rest/v1/sc_member_profiles');
 assert.deepEqual(JSON.parse(insert.body),{user_id:uid,email:'member@example.test',display_name:'Member QA'});
 assert.ok(insert.headers.Prefer.includes('ignore-duplicates'));
});
test('no private API key returns 503 after valid auth, never access',async()=>{
 const {createWorker}=await workerImport;
 const res=await createWorker({fetchFn:stub()}).fetch(get('/api/member?action=me'),{...env,SUPABASE_SECRET_KEY:''});
 assert.equal(res.status,503);
});
test('upstream auth and SQL errors fail closed',async()=>{
 const {createWorker}=await workerImport;
 for(const failPath of ['/auth/v1/user','/rest/v1/sc_member_profiles','/rest/v1/sc_paid_access','/rest/v1/rpc/sc_trial_state']){
  const res=await createWorker({fetchFn:stub({failPath})}).fetch(get('/api/member?action=me'),env);
  assert.equal(res.status,503,failPath);
 }
});
test('unexpected trial status and credit counts cannot grant trial',async()=>{
 const {createWorker}=await workerImport;
 const res=await createWorker({fetchFn:stub({trialData:{...trial,signalsUsed:99}})}).fetch(get('/api/member?action=me'),env);
 assert.equal(res.status,503);
});


const browserEnv={...env,
 SC_EMAIL_DEVICE_TRIAL_ENABLED:'true',
 SC_TRIAL_HMAC_SECRET:'synthetic_browser_hmac_secret_for_test_only_123456789',
 SC_TRIAL_ROLLOUT_AT:'2026-11-01T00:00:00Z',
 SC_TURNSTILE_SITE_KEY:'test-site-key-not-real',
 SC_TURNSTILE_SECRET_KEY:'test-secret-key-not-real-and-long'
};
const recentAuth={...user,created_at:'2026-11-10T08:00:00Z'};
const trialToken='test-turnstile-token-value-long-enough';
function trialFetch({authUser=recentAuth,trialData=trial,collect=[],hostname='staging.example.test',action='trial_activate'}={}){
 const base=stub({authUser,trialData,collect});
 return async (url,opts={})=>{
  const u=String(url);
  if(u.includes('/turnstile/v0/siteverify')){
   collect.push({pathname:'/turnstile/v0/siteverify',method:opts.method,body:opts.body});
   return ok({success:true,hostname,action});
  }
  if(u.includes('/rpc/sc_activate_browser_trial')){
   collect.push({pathname:'/rest/v1/rpc/sc_activate_browser_trial',method:opts.method,body:opts.body});
   return ok({result:'activated',trial:trialData});
  }
  return base(url,opts);
 };
}
test('browser trial activation remains disabled without all secrets and rollout configuration',async()=>{
 const {createWorker}=await workerImport;
 const w=createWorker({fetchFn:trialFetch()});
 const config=await (await w.fetch(get('/api/config',false),env)).json();
 assert.equal(config.emailDeviceTrialEnabled,false);
 assert.equal(config.turnstileSiteKey,null);
 assert.equal((await w.fetch(get('/api/trial?action=device'),env)).status,503);
 assert.equal((await w.fetch(new Request('https://staging.example.test/api/trial?action=activate_browser',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({turnstileToken:trialToken})
 }),env)).status,503);
});
test('verified member creates secure HttpOnly browser recognition cookie',async()=>{
 const {createWorker}=await workerImport;
 const w=createWorker({fetchFn:trialFetch()});
 const config=await (await w.fetch(get('/api/config',false),browserEnv)).json();
 assert.equal(config.emailDeviceTrialEnabled,true);
 assert.equal(config.turnstileSiteKey,browserEnv.SC_TURNSTILE_SITE_KEY);
 const res=await w.fetch(get('/api/trial?action=device'),browserEnv);
 assert.equal(res.status,200);
 const cookie=res.headers.get('Set-Cookie');
 assert.match(cookie,/^__Host-sc_trial_device=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43};/);
 assert.match(cookie,/Secure; HttpOnly; SameSite=Lax/);
 const data=await res.json();
 assert.equal(data.ready,true);
 assert.equal(data.newCookie,true);
});
test('browser-trial device endpoint denies anonymous sessions without generating a cookie',async()=>{
 const {createWorker}=await workerImport;
 const w=createWorker({fetchFn:trialFetch()});
 const res=await w.fetch(get('/api/trial?action=device',false),browserEnv);
 assert.equal(res.status,401);
 assert.equal(res.headers.get('Set-Cookie'),null);
});
test('verified new member and valid Turnstile can request atomic SQL trial activation',async()=>{
 const {createWorker}=await workerImport;
 const calls=[];
 const w=createWorker({fetchFn:trialFetch({collect:calls,trialData:{...trial,trialStatus:'not_activated',signalsRemaining:0,signalsUsed:0,expiresAt:null,activatedAt:null}})});
 const cookie=(await w.fetch(get('/api/trial?action=device'),browserEnv)).headers.get('Set-Cookie').split(';')[0];
 const result=await w.fetch(new Request('https://staging.example.test/api/trial?action=activate_browser',{
  method:'POST',headers:{Authorization:'Bearer '+token,Cookie:cookie,
   'CF-Connecting-IP':'203.0.113.101','Content-Type':'application/json'},
  body:JSON.stringify({turnstileToken:trialToken})
 }),browserEnv);
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.status,'activated');
 const activate=calls.find(x=>x.pathname==='/rest/v1/rpc/sc_activate_browser_trial');
 assert.ok(activate,'transactional SQL RPC must be invoked');
 const params=JSON.parse(activate.body);
 assert.equal(params.p_user,uid);
 assert.match(params.p_device_hash,/^[a-f0-9]{64}$/);
 assert.match(params.p_network_hash,/^[a-f0-9]{64}$/);
 assert.ok(calls.some(x=>x.pathname==='/turnstile/v0/siteverify'));
});
test('missing browser cookie blocks trial activation before the Turnstile request',async()=>{
 const {createWorker}=await workerImport;
 const calls=[];
 const w=createWorker({fetchFn:trialFetch({collect:calls,trialData:{...trial,trialStatus:'not_activated',signalsRemaining:0,signalsUsed:0}})});
 const res=await w.fetch(new Request('https://staging.example.test/api/trial?action=activate_browser',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({turnstileToken:trialToken})
 }),browserEnv);
 assert.equal(res.status,428);
 assert.equal(calls.some(x=>x.pathname==='/turnstile/v0/siteverify'),false);
 assert.equal(calls.some(x=>x.pathname==='/rest/v1/rpc/sc_activate_browser_trial'),false);
});
test('historical accounts cannot receive a new trial without manual history review',async()=>{
 const {createWorker}=await workerImport;
 const calls=[];
 const oldAuth={...recentAuth,created_at:'2026-10-01T08:00:00Z'};
 const w=createWorker({fetchFn:trialFetch({authUser:oldAuth,collect:calls,trialData:{...trial,trialStatus:'not_activated',signalsRemaining:0,signalsUsed:0}})});
 const res=await w.fetch(new Request('https://staging.example.test/api/trial?action=activate_browser',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({turnstileToken:trialToken})
 }),browserEnv);
 assert.equal(res.status,409);
 assert.equal(calls.some(x=>x.pathname==='/rest/v1/rpc/sc_activate_browser_trial'),false);
});
test('Turnstile hostname or action mismatch blocks SQL claim',async()=>{
 const {createWorker}=await workerImport;
 for(const bad of [{hostname:'attacker.example.test'},{action:'login'}]){
  const calls=[];
  const initial={...trial,trialStatus:'not_activated',signalsRemaining:0,signalsUsed:0};
  const w=createWorker({fetchFn:trialFetch({...bad,collect:calls,trialData:initial})});
  const cookie=(await w.fetch(get('/api/trial?action=device'),browserEnv)).headers.get('Set-Cookie').split(';')[0];
  const res=await w.fetch(new Request('https://staging.example.test/api/trial?action=activate_browser',{
   method:'POST',headers:{Authorization:'Bearer '+token,Cookie:cookie,'Content-Type':'application/json'},
   body:JSON.stringify({turnstileToken:trialToken})
  }),browserEnv);
  assert.equal(res.status,403);
  assert.equal(calls.some(x=>x.pathname==='/rest/v1/rpc/sc_activate_browser_trial'),false);
 }
});
test('tampered signed recognition cookies are rejected before calling Turnstile',async()=>{
 const {createWorker}=await workerImport;
 const initial={...trial,trialStatus:'not_activated',signalsRemaining:0,signalsUsed:0};
 const calls=[];
 const w=createWorker({fetchFn:trialFetch({collect:calls,trialData:initial})});
 const raw=(await w.fetch(get('/api/trial?action=device'),browserEnv)).headers.get('Set-Cookie').split(';')[0];
 const cookie=raw.slice(0,-1)+(raw.endsWith('A')?'B':'A');
 const res=await w.fetch(new Request('https://staging.example.test/api/trial?action=activate_browser',{
  method:'POST',headers:{Authorization:'Bearer '+token,Cookie:cookie,'Content-Type':'application/json'},
  body:JSON.stringify({turnstileToken:trialToken})
 }),browserEnv);
 assert.equal(res.status,428);
 assert.equal(calls.some(x=>x.pathname==='/rest/v1/rpc/sc_activate_browser_trial'),false);
});
test('already-used verified trials return existing history without creating a new claim',async()=>{
 const {createWorker}=await workerImport;
 const calls=[];
 const w=createWorker({fetchFn:trialFetch({collect:calls,trialData:trial})});
 const res=await w.fetch(new Request('https://staging.example.test/api/trial?action=activate_browser',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({turnstileToken:trialToken})
 }),browserEnv);
 assert.equal(res.status,200);
 const result=await res.json();
 assert.equal(result.status,'existing_trial');
 assert.equal(calls.some(x=>x.pathname==='/rest/v1/rpc/sc_activate_browser_trial'),false);
});
