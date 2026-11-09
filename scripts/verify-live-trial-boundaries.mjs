#!/usr/bin/env node
// SignalChart read-only live Supabase security smoke test.
// Uses ONLY a public Supabase key. Never accepts/prints service-role keys,
// phone numbers, private signal details, or account identifiers.
import assert from 'node:assert/strict';

const url=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
const publishable=String(process.env.SUPABASE_PUBLISHABLE_KEY||'');
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||
   !(/^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)$/.test(publishable)))
  throw Error('A Supabase project URL and a *publishable* API key are required.');
const headers={apikey:publishable,Accept:'application/json'};
if(publishable.startsWith('eyJ'))headers.Authorization='Bearer '+publishable;

const cases=[
 {name:'trial records inaccessible to anonymous clients',
  path:'/rest/v1/sc_trials?select=id&limit=1'},
 {name:'premium trade payloads inaccessible to anonymous clients',
  path:'/rest/v1/sc_premium_signals?select=signal_key,premium_data&limit=1'},
 {name:'phone trial claims inaccessible to anonymous clients',
  path:'/rest/v1/sc_phone_trial_claims?select=phone_hash&limit=1'},
 {name:'payment entitlements inaccessible to anonymous clients',
  path:'/rest/v1/sc_paid_access?select=id&limit=1'},
 {name:'trial status RPC unavailable to anonymous clients',
  path:'/rest/v1/rpc/sc_trial_state',method:'POST',
  body:{p_user:'00000000-0000-4000-8000-000000000000'}},
 {name:'premium signal catalog RPC unavailable to anonymous clients',
  path:'/rest/v1/rpc/sc_signal_public_list',method:'POST',
  body:{p_market:null,p_limit:1}}
];
let passed=0;
for(const item of cases){
 const method=item.method||'GET';
 const response=await fetch(url+item.path,{
  method,headers:{...headers,...(item.body?{'Content-Type':'application/json'}:{})},
  body:item.body?JSON.stringify(item.body):undefined,
  signal:AbortSignal.timeout(12000),cache:'no-store'});
 const code=response.status;
 // Explicitly deny public access via grants or PostgREST schema exposure.
 // An HTTP 200 (even [] or null) is a FAIL for sensitive resources.
 const blocked=[401,403,404].includes(code);
 console.log((blocked?'PASS':'FAIL')+' '+item.name+' (HTTP '+code+')');
 assert.ok(blocked,'Sensitive SignalChart API unexpectedly publicly accessible: '+item.name);
 passed++;
}
console.log('Verified '+passed+' public-client denial checks. No customer data was read or modified.');
