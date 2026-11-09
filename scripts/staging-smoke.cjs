#!/usr/bin/env node
'use strict';
/**
 * Safe read-only live staging smoke checks.
 * Example:
 *   SC_STAGING_URL=https://<preview>.vercel.app node scripts/staging-smoke.cjs
 * For protected previews set VERCEL_AUTOMATION_BYPASS_SECRET in your local shell
 * (never log or commit it). This script never submits payments, trials or signals.
 */
const assert=require('node:assert/strict');
const origin=String(process.env.SC_STAGING_URL||'').trim().replace(/\/+$/,'');
if(!/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)){
 console.error('SC_STAGING_URL must be an exact Vercel preview URL');
 process.exit(2);
}
const bypass=String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET||'');
async function read(path){
 const headers={Accept:'application/json'};
 if(bypass)headers['x-vercel-protection-bypass']=bypass;
 const res=await fetch(origin+path,{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});
 const body=await res.json().catch(()=>null);
 assert.equal(res.status,200,path+' did not return 200 (HTTP '+res.status+')');
 assert.ok(body&&typeof body==='object',path+' response invalid');
 assert.equal(JSON.stringify(body).includes('sb_secret_'),false,'privileged key leaked in '+path);
 return body;
}
async function run(){
 const config=await read('/api/config');
 assert.equal(config.authProvider,'supabase');
 assert.equal(config.trialHours,72);
 assert.equal(config.trialSignalLimit,3);
 assert.equal(config.paymentsEnabled,false,'staging must not collect payments');
 assert.equal(config.signalsEnabled,false,'staging must not publish legacy signals');
 const health=await read('/api/research?mode=health');
 assert.equal(health.unattendedPublishing.enabled,false,'scanner not cleared for live publishing');
 const feed=await read('/api/premium-signals?action=list');
 assert.ok(Array.isArray(feed.signals));
 for(const row of feed.signals){
  for(const forbidden of ['direction','entry','stopLoss','takeProfit','premium_data','analysis']){
   assert.equal(Object.hasOwn(row,forbidden),false,'premium data leaked by public feed');
  }
 }
 for(const route of ['crypto','forex','signals']){
  const page=await read('/api/'+route);
  assert.ok(Array.isArray(page.items),route+' lacks compatible preview shape');
  assert.equal(JSON.stringify(page.items).includes('stopLoss'),false,'private level leaked');
 }
 const market=await read('/api/market-detail?market=crypto&symbol=BTCUSDT&interval=1h');
 assert.equal(market.market,'crypto');
 assert.ok(Array.isArray(market.candles)&&market.candles.length>=60);
 assert.ok(typeof market.source==='string'&&market.source.length>5);
 assert.equal(JSON.stringify(market).includes('"stopLoss"'),false,'premium levels leaked');
 const calendar=await read('/api/research?mode=calendar&symbol=EURUSD');
 assert.ok(typeof calendar.coverage==='string');
 const quote=await read('/api/checkout?action=quote');
 assert.ok(quote.note?.includes('Reference')||quote.note?.includes('reference'));
 console.log(JSON.stringify({status:'PASS',readOnly:true,endpoints:9,
  trialHours:config.trialHours,trialSignalLimit:config.trialSignalLimit,
  billingDisabled:true,autopublishingDisabled:true,premiumPreviewCount:feed.signals.length,
  candleCount:market.candles.length,calendarCoverage:calendar.coverage},null,2));
}
run().catch(e=>{console.error('STAGING_SMOKE_FAIL:',e.message);process.exitCode=1});
