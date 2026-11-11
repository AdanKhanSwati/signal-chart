'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const workerModule=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const USER='e29aafda-2cc8-4e11-a587-c983dd3f9113';
const OTHER='cd22634c-62ef-4526-ab83-619e202ac09c';
const TOKEN='testing.fake-jwt-authorization-token-with-sufficient-length';
const env={
 SUPABASE_URL:'https://test-instance.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SC_PREMIUM_UNLOCK_ENABLED:'true'
};
const user={id:USER,email:'verified@example.test',email_confirmed_at:'2026-11-11T00:00:00Z',
 created_at:'2026-11-10T00:00:00Z',user_metadata:{role:'admin'}};
const ok=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const request=(action,{method='GET',payload,token=TOKEN,ctype='application/json',market=null}={})=>
 new Request('https://staging.example.test/api/premium-signals?action='+action+(market?'&market='+market:''),{
  method,headers:{...(token?{Authorization:'Bearer '+token}:{}),
   ...(method==='POST'?{'Content-Type':ctype}:{})},
  body:method==='POST'?JSON.stringify(payload):undefined
 });
const sampleSignals=[{signalKey:'crypto:btc-1',market:'crypto',asset:'BTC/USDT',
  publishedAt:'2026-11-11T01:00:00Z',premium_data:{entry:70000,stopLoss:68000}},
 {signalKey:'forex:eurusd-1',market:'forex',asset:'EUR/USD',publishedAt:null,
  privateTargets:['1.12','1.15']}, {signalKey:'crypto:bad<script>',market:'crypto',asset:'ETH'}];
const defaultClaim={allowed:true,reason:'newly_unlocked',signalKey:'crypto:btc-1',data:{
 type:'research',trend:'bullish',entry:70000,stopLoss:68000
},signalsUsed:1,signalsRemaining:2,trialExhausted:false};
function simulated({calls=[],auth=user,paid=[],signals=sampleSignals,claim=defaultClaim,
 detail={found:true,data:{entry:70000,stopLoss:68000}},fail=null}={}){
 return async (url,options={})=>{
  const route=new URL(url),routePath=route.pathname;
  calls.push({path:routePath,method:options.method,body:options.body,headers:options.headers});
  if(fail===routePath)return new Response('Unavailable',{status:503});
  if(routePath==='/auth/v1/user'){
   if(!options.headers?.Authorization?.startsWith('Bearer '+TOKEN))
    return new Response('Unauthorized',{status:401});
   return ok(auth);
  }
  if(routePath==='/rest/v1/sc_paid_access')return ok(paid);
  if(routePath==='/rest/v1/rpc/sc_signal_public_list')return ok(signals);
  if(routePath==='/rest/v1/rpc/sc_unlock_trial')return ok(claim);
  if(routePath==='/rest/v1/rpc/sc_signal_detail_server')return ok(detail);
  throw new Error('Unexpected upstream request: '+routePath);
 };
}
async function worker(fetchFn){const {createWorker}=await workerModule;return createWorker({fetchFn})}
test('Premium listing and unlock remain disabled until expressly enabled',async()=>{
 const calls=[],w=await worker(simulated({calls}));
 const list=await w.fetch(request('list'),{...env,SC_PREMIUM_UNLOCK_ENABLED:'false'});
 assert.deepEqual(await list.json(),{signals:[]});
 const unlock=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:'crypto:btc-1'}}),
  {...env,SC_PREMIUM_UNLOCK_ENABLED:'false'});
 assert.equal(unlock.status,503);
 assert.equal(calls.length,0);
});
test('Anonymous GET lists only safe fields; never entry, stop, private data',async()=>{
 const calls=[],w=await worker(simulated({calls}));
 const res=await w.fetch(request('list',{token:null}),env);
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.signals.length,2);
 assert.deepEqual(Object.keys(body.signals[0]),['signalKey','market','asset','publishedAt']);
 assert.ok(!JSON.stringify(body).includes('stopLoss'));
 assert.ok(!JSON.stringify(body).includes('privateTargets'));
 assert.ok(!JSON.stringify(body).includes('<script>'));
 assert.equal(res.headers.get('Cache-Control'),'private, no-store, max-age=0');
 assert.deepEqual(JSON.parse(calls[0].body),{p_market:null,p_limit:50});
});
test('List filters a valid market; rejects unknown markets without database access',async()=>{
 const calls=[],w=await worker(simulated({calls}));
 const okList=await w.fetch(request('list',{market:'forex'}),env);
 assert.equal(okList.status,200);
 assert.deepEqual(JSON.parse(calls[0].body),{p_market:'forex',p_limit:50});
 const invalid=await w.fetch(request('list',{market:'metals'}),env);
 assert.equal(invalid.status,400);
 assert.equal(calls.length,1);
});
test('GET cannot unlock and POST cannot list premium data',async()=>{
 const calls=[],w=await worker(simulated({calls}));
 for(const req of [request('unlock'),request('list',{method:'POST',payload:{}})]){
  const res=await w.fetch(req,env);
  assert.equal(res.status,405);
 }
 assert.equal(calls.length,0);
});
test('Unauthenticated user cannot unlock and metadata role admin is not trusted',async()=>{
 const calls=[],w=await worker(simulated({calls}));
 const res=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:'crypto:btc-1'},token:null}),env);
 assert.equal(res.status,401);
 assert.equal(calls.length,0);
});
test('Verified trial unlock goes through atomic three-credit Supabase RPC',async()=>{
 const calls=[],w=await worker(simulated({calls}));
 const res=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:'crypto:btc-1',
  isAdmin:true,paid:true,uid:OTHER}}),env);
 assert.equal(res.status,200);
 const result=await res.json();
 assert.deepEqual(result.signal,defaultClaim.data);
 assert.equal(result.signalsUsed,1);
 assert.equal(result.signalsRemaining,2);
 assert.equal(result.reason,'newly_unlocked');
 assert.equal(result.trialExhausted,false);
 assert.equal(calls.some(x=>x.path==='/rest/v1/rpc/sc_signal_detail_server'),false);
 const unlock=calls.find(x=>x.path==='/rest/v1/rpc/sc_unlock_trial');
 assert.deepEqual(JSON.parse(unlock.body),{p_user:USER,p_signal_key:'crypto:btc-1'});
 assert.equal(res.headers.get('Cache-Control'),'private, no-store, max-age=0');
 assert.ok(!JSON.stringify(result).includes(env.SUPABASE_SECRET_KEY));
});
test('SQL allows reopening one of three already-unlocked signals without new credit',async()=>{
 const calls=[],w=await worker(simulated({calls,claim:{
  allowed:true,reason:'previously_unlocked',data:defaultClaim.data,
  signalsUsed:3,signalsRemaining:0
 }}));
 const res=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:'crypto:btc-1'}}),env);
 assert.equal(res.status,200);
 assert.equal((await res.json()).reason,'previously_unlocked');
 assert.equal(calls.filter(x=>x.path==='/rest/v1/rpc/sc_unlock_trial').length,1);
});
test('Fourth unique signal is forbidden without leaking premium details',async()=>{
 const w=await worker(simulated({claim:{
  allowed:false,reason:'trial_exhausted',signalsUsed:3,signalsRemaining:0
 }}));
 const res=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:'crypto:btc-4'}}),env);
 assert.equal(res.status,403);
 const result=await res.json();
 assert.equal(result.reason,'trial_exhausted');
 assert.equal(result.signalsUsed,3);
 assert.equal(result.signalsRemaining,0);
 assert.equal('signal' in result,false);
});
test('Historical verified and still-active paid SQL entitlement can open signal without spending trial credit',async()=>{
 const paid=[{user_id:USER,source:'legacy_verified_payment',
  starts_at:new Date(Date.now()-3600000).toISOString(),
  expires_at:new Date(Date.now()+3600000).toISOString(),
  revoked_at:null}];
 const calls=[],w=await worker(simulated({calls,paid}));
 const res=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:'crypto:btc-1'}}),env);
 assert.equal(res.status,200);
 const result=await res.json();
 assert.equal(result.reason,'membership');
 assert.deepEqual(result.signal,{entry:70000,stopLoss:68000});
 assert.equal(calls.some(x=>x.path==='/rest/v1/rpc/sc_unlock_trial'),false);
 assert.equal(calls.filter(x=>x.path==='/rest/v1/rpc/sc_signal_detail_server').length,1);
});
test('Revoked or other-user paid records fail closed',async()=>{
 const paid=[{user_id:OTHER,source:'verified_crypto_payment',
  starts_at:new Date(Date.now()-3600000).toISOString(),
  expires_at:new Date(Date.now()+3600000).toISOString(),revoked_at:null}];
 const calls=[],w=await worker(simulated({calls,paid}));
 const res=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:'crypto:btc-1'}}),env);
 assert.equal(res.status,503);
 assert.equal(calls.some(x=>x.path==='/rest/v1/rpc/sc_unlock_trial'),false);
 assert.equal(calls.some(x=>x.path==='/rest/v1/rpc/sc_signal_detail_server'),false);
});
test('Invalid signal keys and oversized request are rejected before credit consumption',async()=>{
 const calls=[],w=await worker(simulated({calls}));
 for(const key of ['x', '<script>alert(1)</script>', 'A'.repeat(141)]){
  const res=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:key}}),env);
  assert.equal(res.status,400,key);
 }
 const tooLarge='X'.repeat(5100);
 const r=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:tooLarge}}),env);
 assert.ok([400,413].includes(r.status));
 assert.equal(calls.filter(x=>x.path==='/rest/v1/rpc/sc_unlock_trial').length,0);
});
test('Unverified email session cannot access premium trial even with forged admin metadata',async()=>{
 const auth={...user,email_confirmed_at:null};
 const calls=[],w=await worker(simulated({calls,auth}));
 const res=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:'crypto:btc-1'}}),env);
 assert.equal(res.status,401);
 assert.equal(calls.length,1);
});
test('Invalid database response never releases paid or trial signal data',async()=>{
 const w=await worker(simulated({claim:{allowed:true,reason:'newly_unlocked',data:null}}));
 const res=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:'crypto:btc-1'}}),env);
 assert.equal(res.status,503);
});
test('Unavailable Supabase entitlement service fails closed',async()=>{
 const calls=[],w=await worker(simulated({calls,fail:'/rest/v1/sc_paid_access'}));
 const res=await w.fetch(request('unlock',{method:'POST',payload:{signalKey:'crypto:btc-1'}}),env);
 assert.equal(res.status,503);
 assert.equal(calls.some(x=>x.path==='/rest/v1/rpc/sc_unlock_trial'),false);
});
