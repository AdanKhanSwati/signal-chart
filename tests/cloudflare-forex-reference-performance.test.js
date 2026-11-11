'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const mod=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/forex-reference.mjs')).href);
const get=(query='market=forex',method='GET')=>
 new Request('https://staging.example.test/api/quotes?'+query,{method});
const source={
 amount:1,base:'USD',date:'2026-11-10',
 rates:{EUR:.85,GBP:.76,JPY:154.3,CHF:.9,AUD:1.5,NZD:1.8,CAD:1.3}
};
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const price=(v)=>Math.round(v*1e7)/1e7;

test('Frankfurter reference quotes are computed from actual dated provider ratios, never labeled live',async()=>{
 const {getForexReferences}=await mod;
 let calls=0;
 const out=await getForexReferences(get(),{
  now:()=>1000,
  fetchFn:async(url)=>{
   assert.equal(url,'https://api.frankfurter.dev/v1/latest?base=USD');
   calls++;return json(source);
  }
 });
 assert.equal(calls,1);
 assert.equal(out.status,200);
 const body=await out.json();
 assert.equal(body.referenceOnly,true);
 assert.equal(body.tradable,false);
 assert.equal(body.referenceDate,'2026-11-10');
 assert.match(body.note,/Not real-time trading prices/);
 assert.equal(price(body.quotes.EURUSD.price),price(1/.85));
 assert.equal(price(body.quotes.USDJPY.price),price(154.3));
 assert.equal(price(body.quotes.EURJPY.price),price(154.3/.85));
 assert.equal(body.quotes.GBPUSD.reference,true);
 assert.equal(body.quotes.GBPUSD.tradable,false);
 assert.equal(body.quotes.GBPUSD.stale,true);
 assert.equal(body.quotes.GBPUSD.referenceDate,'2026-11-10');
 assert.equal(body.quotes.GBPUSD.bid,null);
 assert.equal(body.quotes.GBPUSD.ask,null);
 assert.equal(body.quotes.GBPUSD.changePercent,null);
 assert.doesNotMatch(JSON.stringify(body),/entryZone|stopLoss|takeProfit|signalConfidence/);
});
test('Forex reference cache reuses one historical FX snapshot and accepts validated pair filtering',async()=>{
 const {getForexReferences}=await mod;
 let called=0;
 const r=await getForexReferences(get('market=forex&symbol=EURUSD'),{
  now:()=>2000,fetchFn:async()=>{called++;throw Error('Should be cached')}
 });
 assert.equal(r.status,200);
 const obj=await r.json();
 assert.deepEqual(Object.keys(obj.quotes),['EURUSD']);
 assert.equal(obj.quotes.EURUSD.reference,true);
 assert.equal(called,0);
});
test('Forex references reject invalid symbol, wrong method and crypto market without upstream access',async()=>{
 const {getForexReferences}=await mod;
 let called=0,params={fetchFn:async()=>{called++;return json(source)}};
 assert.equal((await getForexReferences(get('market=crypto'),params)).status,503);
 assert.equal((await getForexReferences(get('market=forex&symbol=EURUSD%2Fadmin'),params)).status,400);
 assert.equal((await getForexReferences(get('market=forex','POST'),params)).status,405);
 assert.equal(called,0);
});
test('Provider failure is not converted to fake rates, and is briefly cached',async()=>{
 const {getForexReferences}=await mod;
 let calls=0;
 const result=await getForexReferences(get(),{
  now:()=>2000000,fetchFn:async()=>{calls++;return new Response('upstream fail',{status:503})}
 });
 assert.equal(result.status,502);
 assert.equal(calls,1);
 assert.deepEqual(Object.keys(await result.json()),['error']);
 const next=await getForexReferences(get(),{
  now:()=>2001000,fetchFn:async()=>{calls++;return json(source)}
 });
 assert.equal(next.status,502);
 assert.equal(calls,1);
});
test('Terminal uses historical sources and paints reference snapshots without frequent quote polling',()=>{
 const s=fs.readFileSync(path.resolve(__dirname,'../market-charts.js'),'utf8');
 const feed=fs.readFileSync(path.resolve(__dirname,'../market-feed.js'),'utf8');
 assert.match(s,/fetch\('\/api\/quotes\?market=forex'/);
 assert.match(s,/data\.referenceOnly!==true/);
 assert.match(s,/quote\.reference\?'Daily reference/);
 assert.match(s,/if\(q\.reference===true\)return 'REFERENCE'/);
 assert.match(s,/setInterval\(\(\)=>\{if\(!document\.hidden\)loadQuotes\(\)\},900000\)/);
 assert.doesNotMatch(s,/fetch\('\/api\/quotes\?market=crypto/);
 assert.doesNotMatch(s,/setInterval\(\(\)=>\{if\(!document\.hidden\)loadQuotes\(\)\},30000\)/);
 assert.match(s,/tickRender>9000/);
 assert.match(feed,/dataset\?\.unified==='terminal'\?3000:350/);
 assert.match(feed,/addEventListener\('visibilitychange'/);
 assert.match(feed,/state\.tickClose\?\.\(\);state\.tickClose=null/);
});
test('Hosted source fallback is an independently labeled non-signal chart, with lazy module loading',()=>{
 const s=fs.readFileSync(path.resolve(__dirname,'../market-charts.js'),'utf8');
 assert.match(s,/widgets\.tradingview-widget\.com\/w\/en\/tv-advanced-chart\.js/);
 assert.match(s,/widget\.setAttribute\('symbol',symbol\)/);
 assert.match(s,/TradingView hosted FX chart/);
 assert.match(s,/TradingView hosted Binance spot chart · not futures/);
 assert.match(s,/internal indicators unavailable/);
 assert.match(s,/await renderHostedChart\(p,interval,id\)/);
 assert.match(s,/No historical chart provider is available/);
});
