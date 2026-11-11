'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const mod=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/market-candles.mjs')).href);
const request=(params,method='GET')=>new Request('https://signalchart-staging.example.test/api/candles?'+params,{method});
const json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const start=Math.floor(Date.now()/60000)*60000-3000000;
const bars=Array.from({length:12},(_,i)=>[start+i*60000,'100','105','95','102','120']);
test('crypto candles return bounded provider candles with no invented trading signals',async()=>{
 const {getCandles}=await mod;
 const res=await getCandles(request('market=crypto&symbol=BTCUSDT&interval=1m'),{
  now:()=>1000,
  fetchFn:async(url)=>{
   assert.match(url,/^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines/);
   assert.ok(url.includes('symbol=BTCUSDT'));
   return json(bars);
  }
 });
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.market,'crypto');
 assert.equal(data.symbol,'BTCUSDT');
 assert.equal(data.candles.length,bars.length);
 assert.deepEqual(Object.keys(data.candles[0]),['time','open','high','low','close','volume']);
 assert.match(data.quoteBasis,/Futures/);
 assert.ok(!JSON.stringify(data).includes('signalConfidence'));
});
test('repeated quote request reuses cached OHLC data without another provider request',async()=>{
 const {getCandles}=await mod;
 let calls=0;
 const res=await getCandles(request('market=crypto&symbol=BTCUSDT&interval=1m'),{
  now:()=>6000,
  fetchFn:async()=>{calls++;throw Error('Cache should prevent new upstream fetch')}
 });
 assert.equal(res.status,200);
 assert.equal(calls,0);
});
test('invalid input is rejected before an external provider call',async()=>{
 const {getCandles}=await mod;
 let calls=0,fetchFn=async()=>{calls++;return json(bars)};
 for(const q of [
  'market=crypto&symbol=BTCUSDT%26foo%3Dbar&interval=1m',
  'market=crypto&symbol=BTCUSDT&interval=0m',
  'market=forex&symbol=ZZZZZZ&interval=1h',
  'market=other&symbol=BTCUSDT&interval=15m'
 ]){
  const res=await getCandles(request(q),{fetchFn});
  assert.equal(res.status,400,q);
 }
 assert.equal((await getCandles(request('market=crypto&symbol=BTCUSDT','POST'),{fetchFn})).status,405);
 assert.equal(calls,0);
});
test('historical FX data is indicative and can fail over between two Yahoo hosts',async()=>{
 const {getCandles}=await mod;
 const stamps=Array.from({length:12},(_,i)=>1700000000+i*300);
 const quote={
  open:stamps.map(()=>1.10),high:stamps.map(()=>1.12),
  low:stamps.map(()=>1.09),close:stamps.map(()=>1.11),volume:stamps.map(()=>0)
 };
 const calls=[];
 const res=await getCandles(request('market=forex&symbol=EURUSD&interval=5m'),{
  now:()=>10000,
  fetchFn:async(url)=>{
   calls.push(url);
   if(url.includes('query1.finance.yahoo.com'))return new Response('provider outage',{status:502});
   if(url.includes('query2.finance.yahoo.com'))return json({chart:{result:[{timestamp:stamps,indicators:{quote:[quote]}}]}});
   throw Error('Unexpected upstream');
  }
 });
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.candles.length,12);
 assert.match(data.quoteBasis,/not broker-executable/);
 assert.equal(calls.length,2);
 assert.ok(calls.every(x=>x.startsWith('https://query')));
});
test('provider failures explicitly return 502 instead of fabricated price history',async()=>{
 const {getCandles}=await mod;
 const res=await getCandles(request('market=crypto&symbol=SOLUSDT&interval=15m'),{
  now:()=>11000,fetchFn:async()=>{throw Error('Provider unavailable')}
 });
 assert.equal(res.status,502);
 assert.equal((await res.json()).error,'Market candles temporarily unavailable');
});
test('USDC futures symbols follow the same validated candle path',async()=>{
 const {getCandles}=await mod;
 const res=await getCandles(request('market=crypto&symbol=ETHUSDC&interval=1h'),{
  now:()=>12000,fetchFn:async(url)=>{
   assert.ok(url.includes('ETHUSDC'));
   return json(bars);
  }
 });
 assert.equal(res.status,200);
 assert.equal((await res.json()).symbol,'ETHUSDC');
});
test('Cloudflare Worker forwards GET candle requests without requiring sign in',async()=>{
 const {createWorker}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
 const w=createWorker({fetchFn:async(url)=>json(bars)});
 const res=await w.fetch(request('market=crypto&symbol=DOTUSDT&interval=1m'),{});
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.market,'crypto');
 assert.equal(data.candles.length,12);
});
