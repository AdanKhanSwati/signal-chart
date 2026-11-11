'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const mod=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const request=(path,method='GET')=>new Request('https://staging.example.test'+path,{method});
test('Worker liveness is distinct from production readiness',async()=>{
 const {createWorker}=await mod;
 let calls=0;
 const w=createWorker({fetchFn:async()=>{calls++;throw Error('no remote calls')}});
 const health=await w.fetch(request('/api/health'),{});
 assert.equal(health.status,200);
 const status=await health.json();
 assert.equal(status.ok,true);
 assert.equal(status.productionReady,false);
 const ready=await w.fetch(request('/api/ready'),{});
 assert.equal(ready.status,503);
 const body=await ready.json();
 assert.equal(body.ready,false);
 assert.equal(body.productionReady,false);
 assert.equal(body.status,'migration_incomplete');
 assert.equal(body.checks.historicalBlobReconciliationVerified,false);
 assert.equal(body.checks.adminBillingMigrationVerified,false);
 assert.equal(body.checks.signedInStagingBrowserQAVerified,false);
 assert.equal(body.customerPaymentCollectionAvailable,false);
 assert.ok(body.blockedBy.includes('historical_blob_recovery'));
 assert.equal(calls,0);
});
test('Even all configured secrets cannot accidentally turn staging into launch readiness',async()=>{
 const {createWorker}=await mod;
 const key='sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
 const env={
  SUPABASE_URL:'https://test-qa.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
  SUPABASE_SECRET_KEY:key,
  SC_SUPER_ADMIN_UID:'e29aafda-2cc8-4e11-a587-c983dd3f9113',
  SC_PREMIUM_UNLOCK_ENABLED:'true',
  SC_EMAIL_DEVICE_TRIAL_ENABLED:'true',
  SC_TRIAL_HMAC_SECRET:'test-only-browser-signature-secret-123456789',
  SC_TRIAL_ROLLOUT_AT:'2026-11-11T00:00:00Z',
  SC_TURNSTILE_SITE_KEY:'sitekey-test-123456789',
  SC_TURNSTILE_SECRET_KEY:'turnstile-test-secret-123456789',
  ASSETS:{fetch:async()=>new Response('static')}
 };
 const res=await createWorker({fetchFn:async()=>{throw Error('unexpected')}}).fetch(
  request('/api/ready'),env);
 assert.equal(res.status,503);
 const data=await res.json();
 assert.equal(data.checks.staticAssetsBindingPresent,true);
 assert.equal(data.checks.publicSupabaseConfigPresent,true);
 assert.equal(data.checks.privateSupabaseCredentialPresent,true);
 assert.equal(data.checks.browserTrialConfigured,true);
 assert.equal(data.checks.premiumUnlockFlagEnabled,true);
 assert.equal(data.productionReady,false);
 assert.equal(data.checks.historicalBlobReconciliationVerified,false);
 assert.equal(data.checks.productionDnsCutoverApproved,false);
 const body=JSON.stringify(data);
 assert.ok(!body.includes(key));
 assert.ok(!body.includes(env.SC_TRIAL_HMAC_SECRET));
 assert.ok(!body.includes(env.SC_TURNSTILE_SECRET_KEY));
 assert.ok(!body.includes(env.SC_SUPER_ADMIN_UID));
});
test('Readiness cannot be modified through POST or other methods',async()=>{
 const {createWorker}=await mod;
 const w=createWorker({fetchFn:async()=>{throw Error('unexpected')}});
 for(const method of ['POST','PUT','DELETE']){
  const res=await w.fetch(request('/api/ready',method),{});
  assert.equal(res.status,405);
 }
});
