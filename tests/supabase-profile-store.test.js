'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createProfileStore}=require('../lib/supabase-profile-store');

const UID='c27e005e-e7f0-4f2b-8af6-8839002fb32e';
const env={SUPABASE_URL:'https://example-test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_abcdefghijklmnopqrstuvwxyz123456'};
const record={
 user_id:UID,email:'qa@example.invalid',display_name:'QA',
 legacy_status:'unreconciled',created_at:'2026-11-10T00:00:00Z',
 updated_at:'2026-11-10T00:00:00Z'
};
const ok=(data)=>({ok:true,status:200,json:async()=>data});
const person={uid:UID,email:'qa@example.invalid',name:'QA',isAdmin:true,trialActive:true};

test('existing profile only reads once and never overwrites historical or entitlement data',async()=>{
 const requests=[];
 const store=createProfileStore({env,fetchFn:async(url,opts)=>{
  requests.push({url,opts});return ok([record]);
 }});
 const result=await store.ensureProfile({...person,email:'different@example.invalid'});
 assert.deepEqual(result,record);
 assert.equal(requests.length,1);
 assert.equal(requests[0].opts.method,'GET');
 assert.match(requests[0].url,/user_id=eq/);
 assert.equal(requests[0].opts.headers.apikey,env.SUPABASE_SECRET_KEY);
 assert.equal(requests[0].opts.headers.Authorization,undefined);
});

test('new verified user is inserted once with server-side immutable default status',async()=>{
 const requests=[];let inserted=false;
 const store=createProfileStore({env,fetchFn:async(url,opts)=>{
  requests.push({url,opts});
  if(opts.method==='POST'){inserted=true;return {ok:true,status:201}}
  return ok(inserted?[record]:[]);
 }});
 const result=await store.ensureProfile(person);
 assert.equal(result.user_id,UID);
 assert.equal(requests.filter(x=>x.opts.method==='POST').length,1);
 const insert=requests.find(x=>x.opts.method==='POST');
 assert.deepEqual(JSON.parse(insert.opts.body),{user_id:UID,email:'qa@example.invalid',display_name:'QA'});
 assert.equal(insert.opts.headers.Authorization,undefined);
 assert.match(insert.opts.headers.Prefer,/ignore-duplicates/);
 assert.ok(!insert.opts.body.includes('isAdmin'));
 assert.ok(!insert.opts.body.includes('trialActive'));
});

test('existing account re-login needs no write and no quota-consuming collection scan',async()=>{
 let n=0;const store=createProfileStore({env,fetchFn:async(url,opts)=>{
  n++;assert.equal(opts.method,'GET');return ok([record]);
 }});
 await store.ensureProfile(person);
 await store.ensureProfile(person);
 assert.equal(n,2);
});

test('failed Supabase read fails closed without writing or returning fake access',async()=>{
 let calls=0;const store=createProfileStore({env,fetchFn:async()=>{calls++;return {ok:false,status:500}}});
 await assert.rejects(store.ensureProfile(person),e=>e.status===503);
 assert.equal(calls,1);
});

test('missing secret refuses access before making requests',async()=>{
 let calls=0;
 const store=createProfileStore({env:{SUPABASE_URL:env.SUPABASE_URL},fetchFn:async()=>{calls++;return ok([])}});
 await assert.rejects(store.ensureProfile(person),e=>e.status===503);
 assert.equal(calls,0);
});

test('invalid user IDs are rejected before REST access',async()=>{
 let calls=0;const store=createProfileStore({env,fetchFn:async()=>{calls++;return ok([])}});
 await assert.rejects(store.ensureProfile({...person,uid:'../../admin'}),e=>e.status===401);
 assert.equal(calls,0);
});

test('recovered record must match requested user ID',async()=>{
 const store=createProfileStore({env,fetchFn:async()=>ok([{...record,user_id:'394c5043-68dc-4ae7-87ea-c4c42d8fdd42'}])});
 await assert.rejects(store.ensureProfile(person),e=>e.status===503);
});

test('POST success without a consistent readable record cannot silently succeed',async()=>{
 const store=createProfileStore({env,fetchFn:async(url,opts)=>opts.method==='GET'?ok([]):{ok:true,status:201}});
 await assert.rejects(store.ensureProfile(person),e=>e.status===503);
});

test('network outage is reported without leaking upstream internals',async()=>{
 const store=createProfileStore({env,fetchFn:async()=>{throw Error('SECRET root cause should not appear')}});
 await assert.rejects(store.ensureProfile(person),e=>e.status===503&&!e.message.includes('SECRET'));
});

test('legacy service-role JWT is server-only and included only in privileged requests',async()=>{
 const legacy='eyJ'+('x'.repeat(95));
 const seen=[];
 const store=createProfileStore({env:{SUPABASE_URL:env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:legacy},fetchFn:async(url,opts)=>{
  seen.push(opts.headers);return ok([record]);
 }});
 await store.ensureProfile(person);
 assert.equal(seen[0].apikey,legacy);
 assert.equal(seen[0].Authorization,'Bearer '+legacy);
});
