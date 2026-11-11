'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const mod=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/market-catalog.mjs')).href);

const ok=(body)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
test('market catalog preserves all supported forex pairs and filters active Binance perpetuals',async()=>{
 const {listMarkets}=await mod;
 let calls=0;
 const response=await listMarkets({now:()=>100,
  fetchFn:async(url)=>{
   calls++;assert.equal(url,'https://fapi.binance.com/fapi/v1/exchangeInfo');
   return ok({symbols:[
    {symbol:'BTCUSDT',baseAsset:'BTC',quoteAsset:'USDT',status:'TRADING',contractType:'PERPETUAL'},
    {symbol:'ETHUSDC',baseAsset:'ETH',quoteAsset:'USDC',status:'TRADING',contractType:'PERPETUAL'},
    {symbol:'DOGEUSDT',baseAsset:'DOGE',quoteAsset:'USDT',status:'BREAK',contractType:'PERPETUAL'},
    {symbol:'BTCUSDT',baseAsset:'BTC',quoteAsset:'USDT',status:'TRADING',contractType:'PERPETUAL'},
    {symbol:'SOLUSDT',baseAsset:'SOL',quoteAsset:'USDT',status:'TRADING',contractType:'CURRENT_QUARTER'}
   ]});
  }});
 const out=await response.json();
 assert.equal(calls,1);
 assert.equal(out.count.crypto,2);
 assert.ok(out.count.forex>=40);
 assert.equal(out.markets[0].symbol,'BTCUSDT');
 assert.equal(out.markets[1].symbol,'ETHUSDC');
 assert.ok(out.markets.some(x=>x.symbol==='EURUSD'&&x.type==='forex'));
 assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 assert.match(out.note,/not broker-executable/i);
});
test('market catalog cache avoids unnecessary Binance requests within 10 minutes',async()=>{
 const {listMarkets}=await mod;
 let calls=0;
 const response=await listMarkets({now:()=>599900,fetchFn:async()=>{calls++;throw Error('Should not fetch again')}});
 const data=await response.json();
 assert.equal(calls,0);
 assert.equal(data.count.crypto,2);
});
test('market catalog uses a usable crypto fallback when the exchange is unreachable',async()=>{
 const {listMarkets}=await mod;
 let calls=0;
 const response=await listMarkets({now:()=>600200,fetchFn:async()=>{calls++;throw Error('Exchange unavailable')}});
 const data=await response.json();
 assert.equal(calls,1);
 assert.ok(data.markets.some(x=>x.symbol==='BTCUSDT'));
 assert.ok(data.count.crypto>=20);
 assert.ok(data.count.forex>=40);
 assert.match(data.source,/Fallback/i);
});
test('unsafe symbols and malformed exchange responses are never passed through',async()=>{
 const {listMarkets}=await mod;
 const response=await listMarkets({now:()=>1200300,fetchFn:async()=>ok({symbols:[
  {symbol:'x<script>',baseAsset:'B',quoteAsset:'USDT',status:'TRADING',contractType:'PERPETUAL'}
 ]})});
 const result=await response.json();
 assert.match(result.source,/Fallback/);
 assert.ok(!JSON.stringify(result).includes('<script>'));
});
test('Cloudflare Worker serves public market discovery without requiring sign in',async()=>{
 const {createWorker}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
 const w=createWorker({fetchFn:async()=>{throw Error('Market upstream unavailable')}});
 const data=await w.fetch(new Request('https://sc-staging.example.test/api/markets',{method:'GET'}),{});
 assert.equal(data.status,200);
 const result=await data.json();
 assert.ok(result.markets.length>40);
 assert.equal(result.count.forex>=40,true);
});
