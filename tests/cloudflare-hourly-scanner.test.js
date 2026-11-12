'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac,webcrypto}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const mod=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/auto-scanner.mjs')).href);
const strategy=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/signal-strategy.mjs')).href);
const legacy=require('../lib/sc-auto-engine');
const NOW=Date.UTC(2026,10,12,19,7,0),H=3600000,SECRET='a'.repeat(40);
const url='https://signalchart.staging.example/api/auto-signals';
function candles(now=NOW,n=340){
 const aligned=Math.floor((now-8*60000)/H)*H,first=aligned-(n-1)*H;
 return Array.from({length:n},(_,i)=>{
  const close=100+.06*i+Math.sin(i*1.25)*.38;
  const open=i?100+.06*(i-1)+Math.sin((i-1)*1.25)*.38:close-.12;
  const high=Math.max(open,close)+.16,low=Math.min(open,close)-.16;
  const t=first+i*H;
  return [t,String(open),String(high),String(low),String(close),'100',
   t+H-1];
 });
}
const bars=()=>candles().map(x=>({
 time:x[0],closeTime:x[6],open:+x[1],high:+x[2],low:+x[3],
 close:+x[4],volume:+x[5]
}));
function sign(at=NOW,secret=SECRET){
 const t=String(Math.floor(at/1000));
 return {'x-sc-timestamp':t,
  'x-sc-signature':createHmac('sha256',secret).update(t+'.{}').digest('hex')};
}
const req=(at=NOW,secret=SECRET,method='POST')=>
 new Request(url,{method,headers:sign(at,secret)});
const calendar=(coverage='FULL_WEEK',events=[],checkedAt=NOW)=>async()=>{
 return new Response(JSON.stringify({
  coverage,checkedAt:new Date(checkedAt).toISOString(),events
 }),{headers:{'content-type':'application/json'}});
};
const upstream=async()=>new Response(JSON.stringify(candles()),{
 status:200,headers:{'content-type':'application/json'}
});

test('Cloudflare signal strategy is mathematically identical to legacy closed-hour engine',async()=>{
 const {evaluate,validateBars,STRATEGY}=await strategy;
 assert.equal(STRATEGY,legacy.STRATEGY);
 assert.deepEqual(validateBars(bars(),NOW),legacy.validateBars(bars(),NOW));
 assert.deepEqual(evaluate('BTCUSDT','crypto',bars(),NOW),
  legacy.evaluate('BTCUSDT','crypto',bars(),NOW));
 assert.equal(evaluate('BTCUSDT','crypto',bars(),NOW).status,'CANDIDATE');
});
test('Hourly endpoint requires authenticated HMAC timestamp, never a simple public POST',async()=>{
 const {verifyScanSignature}=await mod;
 const env={SC_AUTO_CRON_SECRET:SECRET};
 assert.equal(await verifyScanSignature(req(),env,{now:()=>NOW,cryptoImpl:webcrypto}),true);
 assert.equal(await verifyScanSignature(req(NOW-240000),env,{now:()=>NOW,cryptoImpl:webcrypto}),false);
 assert.equal(await verifyScanSignature(req(NOW,'b'.repeat(40)),env,{now:()=>NOW,cryptoImpl:webcrypto}),false);
 assert.equal(await verifyScanSignature(req(),{SC_AUTO_CRON_SECRET:'short'},{
  now:()=>NOW,cryptoImpl:webcrypto}),false);
 assert.equal(await verifyScanSignature(new Request(url,{method:'POST',
  headers:{'x-sc-timestamp':String(Math.floor(NOW/1000)),
   'x-sc-signature':'0'.repeat(64)}}),env,{
  now:()=>NOW,cryptoImpl:webcrypto}),false);
});
test('Disabled Cloudflare staging scheduler reads no price/calendar source and cannot publish',async()=>{
 const {createAutoScanner}=await mod;
 let calls=0;
 const scanner=createAutoScanner({fetchFn:async()=>{calls++;throw Error('No fetch')},
  researchHandler:async()=>{calls++;throw Error('No calendar')},
  now:()=>NOW,cryptoImpl:webcrypto,cryptoSymbols:['BTCUSDT'],forexSymbols:[]});
 const disabled={SC_AUTO_CRON_SECRET:SECRET};
 assert.equal((await scanner.handle(req(),disabled)).status,503);
 const out=await scanner.scheduled(disabled);
 assert.equal(out.status,'DISABLED');
 assert.equal(out.published,0);
 assert.equal(calls,0);
 assert.equal((await scanner.handle(req(NOW,SECRET,'GET'),disabled)).status,405);
 assert.equal((await scanner.handle(new Request(url,{method:'POST'}),disabled)).status,401);
});
test('Signed read-only scan checks source-real closed futures and withholds all candidates',async()=>{
 const {createAutoScanner}=await mod;
 let fetched=0;
 const scanner=createAutoScanner({fetchFn:async uri=>{
  fetched++;assert.match(uri,/^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines\?symbol=BTCUSDT/);
  return upstream();
 },researchHandler:calendar(),now:()=>NOW,cryptoImpl:webcrypto,
 cryptoSymbols:['BTCUSDT'],forexSymbols:[]});
 const env={SC_AUTO_CRON_SECRET:SECRET,SC_AUTO_RESEARCH_ENABLED:'true'};
 const response=await scanner.handle(req(),env);
 assert.equal(response.status,200);
 const obj=await response.json();
 assert.equal(fetched,1);
 assert.equal(obj.dryRun,true);assert.equal(obj.published,0);
 assert.equal(obj.qualified,1);assert.equal(obj.scanned,1);
 assert.equal(obj.results[0].status,'CANDIDATE_UNPUBLISHED');
 assert.doesNotMatch(JSON.stringify(obj),/stopLoss|takeProfit|signalKey|entry/);
});
test('Unknown or stale macro source blocks hourly scanner BEFORE any market fetch',async()=>{
 const {createAutoScanner}=await mod;
 for(const [coverage,at]of [['UNKNOWN',NOW],['FULL_WEEK',NOW-30*60000]]){
  let candlesRequested=0;
  const scanner=createAutoScanner({fetchFn:async()=>{candlesRequested++;throw Error('No calls')},
   researchHandler:calendar(coverage,[],at),now:()=>NOW,cryptoImpl:webcrypto,
   cryptoSymbols:['BTCUSDT'],forexSymbols:[]});
  const response=await scanner.handle(req(),{
   SC_AUTO_CRON_SECRET:SECRET,SC_AUTO_RESEARCH_ENABLED:'true'});
  assert.equal(response.status,503);
  const data=await response.json();
  assert.equal(data.status,'BLOCKED_NEWS_DATA');
  assert.equal(data.published,0);assert.equal(candlesRequested,0);
 }
});
test('Scheduled macro window blocks qualifying candidates without ever publishing trade levels',async()=>{
 const {createAutoScanner}=await mod;
 const event={currency:'USD',impact:'high',
  scheduledAt:new Date(NOW+30*60000).toISOString()};
 const scanner=createAutoScanner({fetchFn:upstream,researchHandler:calendar('FULL_WEEK',[event]),
  now:()=>NOW,cryptoImpl:webcrypto,
  cryptoSymbols:['BTCUSDT'],forexSymbols:[]});
 const out=await scanner.run();
 assert.equal(out.results[0].status,'NEWS_BLOCK');
 assert.equal(out.published,0);assert.equal(out.qualified,0);
});
test('Unreachable exchange is counted as unavailable, never as a hypothetical trade',async()=>{
 const {createAutoScanner}=await mod;
 const scanner=createAutoScanner({fetchFn:async()=>new Response('geo-blocked',{status:451}),
  researchHandler:calendar(),now:()=>NOW,cryptoImpl:webcrypto,
  cryptoSymbols:['BTCUSDT'],forexSymbols:[]});
 const out=await scanner.run();
 assert.equal(out.status,'PARTIAL_DATA');
 assert.equal(out.counts.DATA_UNAVAILABLE,1);
 assert.equal(out.published,0);
});
test('Worker Cron trigger and public API never publish premium details',async()=>{
 const config=require('../cloudflare/wrangler.staging.json');
 assert.deepEqual(config.triggers.crons,['7 * * * *']);
 assert.equal(config.keep_vars,true);
 const {createWorker}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
 const worker=createWorker({fetchFn:async()=>{throw Error('Should not fetch')}});
 let promises=0;
 await worker.scheduled({}, {},{waitUntil(p){promises++;return p}});
 assert.equal(promises,1);
 const bad=await worker.fetch(new Request(url,{method:'POST'}),{});
 assert.equal(bad.status,401);
 assert.equal((await bad.json()).error,'Unauthorized');
});
