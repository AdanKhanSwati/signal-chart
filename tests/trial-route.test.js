'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler:trialRoute}=require('../api/trial');
const {createHandler:signalRoute}=require('../api/premium-signals');
const UID='11111111-1111-4111-8111-111111111111';
const state={trialStatus:'not_activated',signalsUsed:0,signalsRemaining:0};
function create(admin=false){
 const calls={unlock:[],rpc:[]};
 const core={
  identity:async req=>{if(!req.headers.authorization)throw Object.assign(Error('Sign-in required'),{status:401});
   return {uid:UID,email:'test@example.test'}},
  member:async()=>({isAdmin:admin,status:admin?'administrator':'locked'}),
  adminOnly:user=>{if(!user.isAdmin)throw Object.assign(Error('Permission denied'),{status:403})},
  securePost:req=>req.body,
  handleError:(res,e)=>res.status(e.status||500).json({error:e.message})
 };
 const gate={
  state:async()=>state,listSignals:async()=>[{signalKey:'crypto:btc:abc',market:'crypto',asset:'BTCUSDT',
    publishedAt:'2026-11-09T00:00:00Z'}],
  premiumUnlock:async(uid,key,paid)=>{calls.unlock.push({uid,key,paid});return {allowed:false,reason:'phone_verification_required'}},
  otpStart:async()=>({status:'otp_sent'}),otpVerify:async()=>({status:'activated'}),
  rpc:async()=>{calls.rpc.push('rpc');return {}},admin:async()=>({})
 };
 async function req(handler,action,method='GET',body={},authorized=true){
  const res={code:200,headers:{},data:null,
   setHeader(k,v){this.headers[k]=v;return this},status(s){this.code=s;return this},
   json(v){this.data=v;return this}};
  await handler({query:{action},method,body,headers:authorized?{authorization:'Bearer fake'}:{}},res);
  return res;
 }
 return {core,gate,req,calls};
}
test('unauthenticated user cannot query trial state',async()=>{
 const x=create();const r=await x.req(trialRoute(x.core,x.gate),'state','GET',{},false);
 assert.equal(r.code,401);
});
test('trial state does not create an entitlement',async()=>{
 const x=create();const r=await x.req(trialRoute(x.core,x.gate),'state');
 assert.equal(r.code,200);assert.equal(r.data.trialStatus,'not_activated');
});
test('free signal previews never contain actionable fields',async()=>{
 const x=create(),h=signalRoute(x.core,x.gate);
 const r=await x.req(h,'list','GET',{},false);
 assert.equal(r.code,200);
 assert.equal(JSON.stringify(r.data).includes('entry'),false);
 assert.equal(JSON.stringify(r.data).includes('stopLoss'),false);
});
test('GET /premium-signals?action=unlock is forbidden',async()=>{
 const x=create(),h=signalRoute(x.core,x.gate);
 const r=await x.req(h,'unlock','GET');
 assert.equal(r.code,405);
 assert.equal(x.calls.unlock.length,0);
});
test('unauthenticated POST cannot unlock premium',async()=>{
 const x=create(),h=signalRoute(x.core,x.gate);
 const r=await x.req(h,'unlock','POST',{signalKey:'crypto:btc:abc'},false);
 assert.equal(r.code,401);assert.equal(x.calls.unlock.length,0);
});
test('locked member cannot retrieve protected details from direct API POST',async()=>{
 const x=create(),h=signalRoute(x.core,x.gate);
 const r=await x.req(h,'unlock','POST',{signalKey:'crypto:btc:abc',paid:true});
 assert.equal(r.code,403);
 assert.deepEqual(x.calls.unlock,[{uid:UID,key:'crypto:btc:abc',paid:false}]);
});
test('ordinary user cannot call admin trial reports or exceptions',async()=>{
 const x=create(),h=trialRoute(x.core,x.gate);
 assert.equal((await x.req(h,'admin_metrics')).code,403);
 assert.equal((await x.req(h,'admin_exception','POST',{userId:UID})).code,403);
});
