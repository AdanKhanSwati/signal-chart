'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTrialGateway}=require('../lib/trial-gate');
const UID='11111111-1111-4111-8111-111111111111';
const publicAuth=()=>({ready:true,url:'https://trial-tests.supabase.co',key:'sb_publishable_safe_demo_key_123456'});
function setup(env){
 let headers=null;
 const core={authConfig:publicAuth};
 const trial=createTrialGateway(core,{env,
  fetchFn:async(url,opts)=>{
   if(!url.endsWith('/rpc/sc_trial_state'))throw Error('unexpected URL');
   headers=opts.headers;
   return {ok:true,json:async()=>({trialStatus:'not_activated',signalsUsed:0})};
  }});
 return {trial,headers:()=>headers};
}
test('current sb_secret backend API key is accepted without fake JWT Authorization',async()=>{
 const key='sb_secret_'+'x'.repeat(32);
 const x=setup({SUPABASE_SECRET_KEY:key});
 assert.equal((await x.trial.state(UID)).trialStatus,'not_activated');
 assert.equal(x.headers().apikey,key);
 assert.equal(Object.hasOwn(x.headers(),'Authorization'),false);
});
test('legacy Supabase service-role JWT remains supported in transition',async()=>{
 const key='eyJ'+'p'.repeat(95);
 const x=setup({SUPABASE_SERVICE_ROLE_KEY:key});
 await x.trial.state(UID);
 assert.equal(x.headers().apikey,key);
 assert.equal(x.headers().Authorization,'Bearer '+key);
});
test('public sb_publishable key is never accepted as privileged credential',async()=>{
 const x=setup({SUPABASE_SECRET_KEY:'sb_publishable_'+'q'.repeat(32)});
 await assert.rejects(()=>x.trial.state(UID),e=>e.status===503);
 assert.equal(x.headers(),null);
});
test('client JWT is never accepted as Supabase administrative credential',async()=>{
 const x=setup({SUPABASE_SERVICE_ROLE_KEY:'customer.jwt.value'});
 await assert.rejects(()=>x.trial.state(UID),e=>e.status===503);
 assert.equal(x.headers(),null);
});
