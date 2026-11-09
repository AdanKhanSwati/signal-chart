#!/usr/bin/env node
'use strict';
/**
 * SignalChart: real Supabase staging trial security smoke test.
 * Read-only! Does not send OTP, consume trial credits, update users, or bill anyone.
 * Requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.
 * Privileged check requires SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.
 * Optional SC_TEST_USER_ACCESS_TOKEN is a throwaway authenticated test-user JWT.
 * Never print credentials, personal data, phone identities, or raw responses.
 */
const assert=require('node:assert/strict');
const base=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
const pub=String(process.env.SUPABASE_PUBLISHABLE_KEY||'');
const server=String(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'');
const secret=String(process.env.SC_TRIAL_HMAC_SECRET||'');
const userToken=String(process.env.SC_TEST_USER_ACCESS_TOKEN||'');
const backendKey=server.startsWith('sb_secret_')||server.startsWith('eyJ');
let failures=0;
function check(name,ok,note=''){
 console.log((ok?'PASS':'FAIL')+' '+name+(note?' ('+note+')':''));
 if(!ok)failures++;
}
async function get(path,method,headers,body){
 const response=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined,
  signal:AbortSignal.timeout(12000),cache:'no-store'});
 let data={};try{data=await response.json()}catch{}
 return {status:response.status,data};
}
(async()=>{
 check('Supabase project URL is HTTPS',/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base));
 check('Publishable key configured',pub.startsWith('sb_publishable_')||pub.startsWith('eyJ'));
 if(failures){process.exitCode=2;return}
 const headers={apikey:pub,'Content-Type':'application/json'};
 for(const [name,path,method,body] of [
  ['Anonymous cannot select trial records','/rest/v1/sc_trials?select=id&limit=1','GET'],
  ['Anonymous cannot select premium details','/rest/v1/sc_premium_signals?select=premium_data&limit=1','GET'],
  ['Anonymous cannot execute trial state RPC','/rest/v1/rpc/sc_trial_state','POST',
    {p_user:'00000000-0000-4000-8000-000000000000'}],
  ['Anonymous cannot unlock trial premium','/rest/v1/rpc/sc_unlock_trial','POST',
    {p_user:'00000000-0000-4000-8000-000000000000',p_signal_key:'crypto:btc:qa-dummy'}]
 ]){
  const response=await get(path,method,headers,body);
  check(name,[401,403].includes(response.status),'HTTP '+response.status);
 }
 const jwt=await get('/auth/v1/user','GET',{...headers,Authorization:'Bearer deliberately-invalid-trial-token'});
 check('Invalid user token rejected',[401,403].includes(jwt.status),'HTTP '+jwt.status);
 check('Stable backend phone HMAC secret present',secret.length>=32);
 check('Server-only Supabase secret key present',backendKey);
 if(!backendKey){console.log('BLOCKED: cannot run server-privileged or valid-session trial RPC checks without protected server key');
  process.exitCode=failures?2:0;return}
 const sHeaders={apikey:server,'Content-Type':'application/json',
   ...(server.startsWith('eyJ')?{Authorization:'Bearer '+server}:{})};
 const smoke=await get('/rest/v1/rpc/sc_trial_state','POST',sHeaders,
  {p_user:'00000000-0000-4000-8000-000000000000'});
 check('Server-only trial RPC reachable',smoke.status===200&&smoke.data?.trialStatus==='not_activated',
  'HTTP '+smoke.status);
 if(userToken){
  const auth=await get('/auth/v1/user','GET',{...headers,Authorization:'Bearer '+userToken});
  const id=String(auth.data?.id||'');
  check('Real authenticated test user recognized',auth.status===200&&/^[0-9a-f-]{36}$/i.test(id),
    'HTTP '+auth.status);
  if(auth.status===200&&/^[0-9a-f-]{36}$/i.test(id)){
   const own=await get('/rest/v1/rpc/sc_trial_state','POST',sHeaders,{p_user:id});
   check('Authenticated test account trial state available',own.status===200&&typeof own.data?.trialStatus==='string',
     'HTTP '+own.status);
  }
 }else console.log('SKIP Valid signed-in user check: SC_TEST_USER_ACCESS_TOKEN not supplied');
 process.exitCode=failures?1:0;
})().catch(()=>{console.error('FAIL Supabase smoke test could not finish. No changes were made.');process.exitCode=1});
