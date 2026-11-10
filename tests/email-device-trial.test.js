'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTrialGateway}=require('../lib/trial-gate');
const UID='11111111-1111-4111-8111-111111111111',TOKEN='qa.jwt.token';
function fixture({enabled=true,challengeValid=true,emailVerified=true,keys=true,legacy=false}={}){
 const calls=[];let issued=null;
 const env={SC_EMAIL_DEVICE_TRIAL_ENABLED:enabled?'true':'false',
  SUPABASE_SERVICE_ROLE_KEY:'eyJ'+'a'.repeat(105),
  SC_TRIAL_HMAC_SECRET:'unit-test-secret-identity-not-production-12345',
  SC_TRIAL_ROLLOUT_AT:'2026-11-01T00:00:00Z',
  SC_TURNSTILE_SITE_KEY:keys?'0x4AAAUNITTEST':'',
  SC_TURNSTILE_SECRET_KEY:keys?'turnstile-unit-test-secret-not-prod':''
 };
 const fetchFn=async (url,options={})=>{
  const body=options.body?(/turnstile/.test(url)?String(options.body):JSON.parse(options.body)):null;
  calls.push({url,body});
  if(url.endsWith('/auth/v1/user'))return {ok:true,status:200,json:async()=>({
   id:UID,email:'qa@example.test',email_confirmed_at:emailVerified?'2026-11-08T00:00:00Z':null,
   created_at:legacy?'2026-10-29T00:00:00Z':'2026-11-08T00:00:00Z'})};
  if(url.endsWith('turnstile/v0/siteverify'))
   return {ok:true,status:200,json:async()=>({success:challengeValid,action:'trial_activate'})};
  if(url.endsWith('/rpc/sc_trial_state'))
   return {ok:true,status:200,json:async()=>({trialStatus:'not_activated'})};
  if(url.endsWith('/rpc/sc_activate_browser_trial'))
   return {ok:true,status:200,json:async()=>({result:'activated',
    trial:{trialStatus:'active',signalsRemaining:3,expiresAt:'2026-11-11T00:00:00Z'}})};
  throw Error('Unexpected fake URL '+url);
 };
 const core={authConfig:()=>({ready:true,url:'https://demo.supabase.co',key:'sb_publishable_sample'}),
  findMemberRecord:async()=>null};
 const gate=createTrialGateway(core,{fetchFn,env,clock:()=>Date.parse('2026-11-09T12:00:00Z')});
 const req={headers:{authorization:'Bearer '+TOKEN,'x-vercel-forwarded-for':'203.0.113.8'}};
 const res={headers:{},setHeader(k,v){this.headers[k]=v}};
 return {gate,req,res,calls,env};
}
test('email-confirmed user gets signed Secure HttpOnly first-party cookie',async()=>{
 const f=fixture(),created=await f.gate.deviceStart(f.req,f.res);
 assert.equal(created.ready,true);
 const cookie=f.res.headers['Set-Cookie'];
 assert.match(cookie,/^__Host-sc_trial_device=/);
 assert.match(cookie,/; Secure; HttpOnly; SameSite=Lax$/);
 assert.match(cookie,/; Path=\/; Max-Age=31536000;/);
 f.req.headers.cookie=cookie.split(';')[0];
 const again=await f.gate.deviceStart(f.req,f.res);
 assert.equal(again.newCookie,false,'Existing browser identity should be reused');
});
test('verified email, signed cookie and successful Turnstile precede database entitlement',async()=>{
 const f=fixture();
 await f.gate.deviceStart(f.req,f.res);
 f.req.headers.cookie=f.res.headers['Set-Cookie'].split(';')[0];
 const result=await f.gate.activateBrowserTrial(f.req,'valid-turnstile-token-12345');
 assert.equal(result.status,'activated');
 assert.equal(result.trial.signalsRemaining,3);
 const claim=f.calls.find(x=>x.url.endsWith('/rpc/sc_activate_browser_trial'));
 assert.match(claim.body.p_device_hash,/^[0-9a-f]{64}$/);
 assert.match(claim.body.p_network_hash,/^[0-9a-f]{64}$/);
 assert.ok(!JSON.stringify(claim.body).includes('203.0.113.8'),'Raw IP must not be sent to SQL');
 assert.equal(f.calls.filter(x=>x.url.endsWith('turnstile/v0/siteverify')).length,1);
});
test('unsigned or modified browser cookie fails without database activation',async()=>{
 const f=fixture();
 await f.gate.deviceStart(f.req,f.res);
 const original=f.res.headers['Set-Cookie'].split(';')[0];
 f.req.headers.cookie=original.slice(0,-1)+'X';
 await assert.rejects(f.gate.activateBrowserTrial(f.req,'valid-turnstile-token-12345'),e=>e.status===428);
 assert.ok(!f.calls.some(c=>c.url.endsWith('/rpc/sc_activate_browser_trial')));
});
test('email unverified, false Turnstile and missing provider keys fail closed',async()=>{
 for(const options of [{emailVerified:false},{challengeValid:false},{keys:false}]){
  const f=fixture(options);
  if(!options.emailVerified&&options.emailVerified===false){
   await assert.rejects(f.gate.deviceStart(f.req,f.res),e=>e.status===403);
   continue;
  }
  await f.gate.deviceStart(f.req,f.res);
  f.req.headers.cookie=f.res.headers['Set-Cookie'].split(';')[0];
  await assert.rejects(f.gate.activateBrowserTrial(f.req,'valid-turnstile-token-12345'),
   e=>[403,503].includes(e.status));
  assert.ok(!f.calls.some(c=>c.url.endsWith('/rpc/sc_activate_browser_trial')));
 }
});
test('trial activation stays off unless explicitly enabled, and legacy users cannot start it',async()=>{
 const off=fixture({enabled:false});
 await assert.rejects(off.gate.deviceStart(off.req,off.res),e=>e.status===503);
 const legacy=fixture({legacy:true});await legacy.gate.deviceStart(legacy.req,legacy.res);
 legacy.req.headers.cookie=legacy.res.headers['Set-Cookie'].split(';')[0];
 await assert.rejects(legacy.gate.activateBrowserTrial(legacy.req,'valid-turnstile-token-12345'),e=>e.status===409);
});
