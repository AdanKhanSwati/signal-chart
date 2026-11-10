#!/usr/bin/env node
'use strict';
/**
 * Safe read-only SignalChart protected preview checks.
 * No payments, trial claims, phone messages, or signal publication.
 *
 * SC_STAGING_URL=https://<preview>.vercel.app
 * VERCEL_AUTOMATION_BYPASS_SECRET=<protected environment variable>
 * node scripts/staging-smoke.cjs
 */
const assert=require('node:assert/strict');
const forbidden=['direction','entry','stopLoss','takeProfit','premium_data','analysis'];
const lockedEndpoints=[
 '/api/member?action=me',
 '/api/trial?action=state',
 '/api/cv-ops?action=me',
 '/api/checkout?action=verify',
 '/api/admin-access?action=members'
];
async function run({fetchFn=globalThis.fetch,origin=process.env.SC_STAGING_URL,
 bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET}={}){
 const base=String(origin||'').trim().replace(/\/+$/,'');
 if(!/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(base))
  throw Error('SC_STAGING_URL must be an exact HTTPS Vercel preview URL');
 async function inspect(path){
  const headers={Accept:'application/json'};
  if(bypass)headers['x-vercel-protection-bypass']=bypass;
  const res=await fetchFn(base+path,{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});
  const body=await res.json().catch(()=>null);
  assert.ok(body&&typeof body==='object',path+' response invalid');
  assert.equal(JSON.stringify(body).includes('sb_secret_'),false,'privileged key leaked in '+path);
  return {http:res.status,body};
 }
 async function read(path){
  const response=await inspect(path);
  assert.equal(response.http,200,path+' did not return 200 (HTTP '+response.http+')');
  return response.body;
 }
 const config=await read('/api/config');
 assert.equal(config.authProvider,'supabase');
 assert.equal(config.trialHours,72);
 assert.equal(config.trialSignalLimit,3);
 assert.equal(config.paymentsEnabled,false,'Staging must not accept payments');
 assert.equal(config.signalsEnabled,false,'Legacy signal publication must remain disabled');
 assert.equal(config.phoneVerificationEnabled,false,'Staging must not send WhatsApp phone messages');
 const health=await read('/api/research?mode=health');
 assert.equal(health.unattendedPublishing.enabled,false,'Automatic publishing must remain disabled');
 const feed=await read('/api/premium-signals?action=list');
 assert.ok(Array.isArray(feed.signals));
 for(const signal of feed.signals)for(const field of forbidden)
  assert.equal(Object.hasOwn(signal,field),false,'Premium trading level leaked: '+field);
 for(const route of ['crypto','forex','signals']){
  const result=await read('/api/'+route);
  assert.ok(Array.isArray(result.items),route+' preview shape incorrect');
  assert.equal(JSON.stringify(result.items).includes('"stopLoss"'),false,route+' leaked premium levels');
 }
 const market=await read('/api/market-detail?market=crypto&symbol=BTCUSDT&interval=1h');
 assert.equal(market.market,'crypto');
 assert.ok(Array.isArray(market.candles)&&market.candles.length>=60);
 assert.ok(typeof market.source==='string'&&market.source.length>5);
 assert.equal(JSON.stringify(market).includes('"stopLoss"'),false);
 const calendar=await read('/api/research?mode=calendar&symbol=EURUSD');
 assert.ok(typeof calendar.coverage==='string');
 const quote=await read('/api/checkout?action=quote');
 assert.ok(/reference/i.test(String(quote.note||'')),'Quote must not be misrepresented as a payable invoice');

 for(const path of lockedEndpoints){
  const {http,body}=await inspect(path);
  assert.equal(http,401,path+' must deny anonymous access (HTTP '+http+')');
  for(const sensitive of ['account','requests','payments','members','trials','receipt','privateData']){
   assert.equal(Object.hasOwn(body,sensitive),false,'Private content leaked by '+path);
  }
 }
 const invalid=[['/api/premium-signals?action=unlock',405],
  ['/api/compat?sc_route=../lib/candriva-core',404]];
 for(const [path,expected] of invalid){
  const response=await inspect(path);
  assert.equal(response.http,expected,path+' bypassed API method/route restrictions');
 }
 const result={status:'PASS',readOnly:true,endpoints:16,
  deniedAnonymousPaths:lockedEndpoints.length,
  trialHours:config.trialHours,trialSignalLimit:config.trialSignalLimit,
  billingDisabled:true,autoPublishingDisabled:true,phoneMessagesDisabled:true,
  premiumPreviewCount:feed.signals.length,candleCount:market.candles.length,
  calendarCoverage:calendar.coverage};
 return result;
}
module.exports={run,lockedEndpoints};
if(require.main===module)run().then(result=>console.log(JSON.stringify(result,null,2)))
 .catch(error=>{console.error('STAGING_SMOKE_FAIL:',error.message);process.exitCode=1});
