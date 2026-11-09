'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTrialGateway,e164}=require('../lib/trial-gate');
const UID='11111111-1111-4111-8111-111111111111',KEY='eyJ'+'x'.repeat(94),TOKEN='customer.jwt.token';
const PHONE='+923001234567',HMAC='p'.repeat(40);
function fixture({allow=true,verified=false,legacy=false,exception=false}={}){
 const calls=[];let verifiedNow=verified;
 const user=()=>({id:UID,email:'customer@example.test',email_confirmed_at:'2026-11-08T00:00:00Z',created_at:legacy?'2026-10-08T00:00:00Z':'2026-11-08T00:00:00Z',
   phone:verifiedNow?PHONE:'',phone_confirmed_at:verifiedNow?'2026-11-09T00:00:00Z':null});
 const fetchFn=async(url,opts={})=>{
  let response={ok:true,status:200};
  const body=opts.body?JSON.parse(opts.body):null;calls.push({url,method:opts.method||'GET',body,headers:opts.headers});
  if(url.endsWith('/auth/v1/user')&&opts.method==='PUT')return {...response,json:async()=>user()};
  if(url.endsWith('/auth/v1/user'))return {...response,json:async()=>user()};
  if(url.endsWith('/auth/v1/verify')){verifiedNow=true;return {...response,json:async()=>({access_token:'verified.jwt.token'})}}
  if(url.endsWith('/rpc/sc_trial_state'))return {...response,json:async()=>({trialStatus:'not_activated',signalsRemaining:0,signalsUsed:0})};
  if(url.endsWith('/rpc/sc_can_override_legacy_trial'))return {...response,json:async()=>exception};
  if(url.endsWith('/rpc/sc_otp_rate_check'))return {...response,json:async()=>({allowed:allow,retryAfterSeconds:60})};
  if(url.endsWith('/rpc/sc_activate_trial'))return {...response,json:async()=>({
    result:'activated',trial:{trialStatus:'active',signalsRemaining:3,expiresAt:'2026-11-12T00:00:00Z'}})};
  if(url.endsWith('/rpc/sc_trial_state'))return {...response,json:async()=>({
    trialStatus:'not_activated',signalsRemaining:0,signalsUsed:0})};
  if(url.endsWith('/rpc/sc_unlock_trial'))return {...response,json:async()=>({
    allowed:true,reason:'newly_unlocked',signalsRemaining:2,signalsUsed:1,data:{entry:123}})};
  if(url.endsWith('/rpc/sc_signal_detail_server'))return {...response,json:async()=>({found:true,data:{entry:123}})};
  throw Error('Unexpected fake fetch: '+url);
 };
 const core={authConfig:()=>({ready:true,url:'https://demo.supabase.co',key:'sb_publishable_test_1234567890'})};
 const gate=createTrialGateway(core,{fetchFn,env:{SUPABASE_SERVICE_ROLE_KEY:KEY,SC_TRIAL_HMAC_SECRET:HMAC,SC_TRIAL_ROLLOUT_AT:'2026-11-01T00:00:00Z'},
   clock:()=>Date.parse('2026-11-09T01:00:00Z')});
 const req={headers:{authorization:'Bearer '+TOKEN,'x-vercel-forwarded-for':'203.0.113.42','x-sc-device-hint':'device_hint_1234567890'}};
 return {gate,calls,req};
}
test('E.164 international mobile validation rejects invalid numbers',()=>{
 assert.equal(e164(PHONE),PHONE);assert.throws(()=>e164('03001234567'));assert.throws(()=>e164('+00012345'));
});
test('trial database fails closed without backend-only service credential',async()=>{
 const x=fixture();const gate=createTrialGateway({authConfig:()=>({ready:true,url:'https://demo.supabase.co',key:'pub'})},{
  fetchFn:async()=>{throw Error('SHOULD NOT FETCH')},env:{SC_TRIAL_HMAC_SECRET:HMAC}});
 await assert.rejects(()=>gate.state(UID),e=>e.status===503);
});
test('OTP starts only after database rate check',async()=>{
 const x=fixture({allow:false});
 await assert.rejects(()=>x.gate.otpStart(x.req,PHONE),e=>e.status===429);
 assert.ok(x.calls.find(z=>z.url.endsWith('sc_otp_rate_check')));
 assert.ok(!x.calls.some(z=>z.method==='PUT'));
});
test('accepted OTP attempt sends Supabase phone change without creating a trial',async()=>{
 const x=fixture();const r=await x.gate.otpStart(x.req,PHONE);
 assert.equal(r.status,'otp_sent');
 assert.equal(x.calls.some(z=>z.method==='PUT'),true);
 assert.equal(x.calls.some(z=>z.url.endsWith('/rpc/sc_activate_trial')),false);
 const risk=x.calls.find(z=>z.url.endsWith('/rpc/sc_otp_rate_check'));
 assert.match(risk.body.p_phone_hash,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(risk.body).includes(PHONE),false);
});
test('SMS OTP verification checks Supabase user ID and confirmed phone before activating',async()=>{
 const x=fixture();const r=await x.gate.otpVerify(x.req,PHONE,'123456');
 assert.equal(r.status,'activated');
 const act=x.calls.find(z=>z.url.endsWith('/rpc/sc_activate_trial'));
 assert.equal(act.body.p_user,UID);
 assert.match(act.body.p_phone_hash,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(act.body).includes(PHONE),false);
});
test('an already verified phone may be activated without repeat SMS',async()=>{
 const x=fixture({verified:true});const r=await x.gate.activateExistingVerifiedPhone(x.req);
 assert.equal(r.status,'activated');
 assert.equal(x.calls.some(z=>z.method==='PUT'),false);
});
test('premium trial unlock requests originate from secure RPC',async()=>{
 const x=fixture();const r=await x.gate.premiumUnlock(UID,'crypto:btc:abc123',false);
 assert.equal(r.allowed,true);assert.equal(r.signalsRemaining,2);
 assert.equal(x.calls.some(z=>z.url.endsWith('/rpc/sc_unlock_trial')),true);
});
test('paid membership bypasses trial credit but still uses protected server detail RPC',async()=>{
 const x=fixture();const r=await x.gate.premiumUnlock(UID,'forex:eurusd:abc123',true);
 assert.equal(r.allowed,true);assert.equal(r.reason,'membership');
 assert.equal(x.calls.some(z=>z.url.endsWith('/rpc/sc_unlock_trial')),false);
});
test('trial rejects fake key reference without contacting database',async()=>{
 const x=fixture();await assert.rejects(()=>x.gate.premiumUnlock(UID,'../../etc/passwd'));
 assert.equal(x.calls.length,0);
});

test('older accounts are denied repeat OTP trial activation before any SMS is sent',async()=>{
 const x=fixture({legacy:true});
 await assert.rejects(()=>x.gate.otpStart(x.req,PHONE),e=>e.status===409);
 assert.equal(x.calls.some(z=>z.method==='PUT'),false);
});
test('an audited recycled-number exception allows verified legacy applicant to request SMS',async()=>{
 const x=fixture({legacy:true,exception:true});const r=await x.gate.otpStart(x.req,PHONE);
 assert.equal(r.status,'otp_sent');
 assert.equal(x.calls.some(z=>z.method==='PUT'),true);
});
