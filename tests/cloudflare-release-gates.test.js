'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const worker = import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const origin='https://staging.example.test';
const env={ASSETS:{fetch:async request=>new Response('asset:'+new URL(request.url).pathname)}};
test('release gate is fail-closed without credentials',async()=>{
 const {createWorker}=await worker;
 const handler=createWorker({fetchFn:async()=>{throw Error('unexpected network request')}});
 const response=await handler.fetch(new Request(origin+'/api/ready'),env);
 assert.equal(response.status,503);
 const body=await response.json();
 assert.equal(body.productionReady,false);
 assert.equal(body.customerPaymentCollectionAvailable,false);
 assert.equal(body.checks.historicalBlobReconciliationVerified,false);
 assert.equal(body.checks.signedInStagingBrowserQAVerified,false);
 assert.ok(!JSON.stringify(body).includes('sb_secret_'));
});
test('readiness cannot be promoted by forged query parameters',async()=>{
 const {createWorker}=await worker;
 const handler=createWorker();
 const response=await handler.fetch(new Request(origin+'/api/ready?productionReady=true&approved=true'),env);
 assert.equal(response.status,503);
 assert.equal((await response.json()).ready,false);
});
test('unmigrated payment and admin routes remain unavailable',async()=>{
 const {createWorker}=await worker;
 const handler=createWorker();
 for(const route of ['/api/checkout','/api/admin-access','/api/signal-publication']){
  const response=await handler.fetch(new Request(origin+route,{method:'POST'}),env);
  assert.equal(response.status,503,route);
 }
});
test('readiness rejects mutation attempts',async()=>{
 const {createWorker}=await worker;
 const response=await createWorker().fetch(new Request(origin+'/api/ready',{method:'POST'}),env);
 assert.equal(response.status,405);
});
