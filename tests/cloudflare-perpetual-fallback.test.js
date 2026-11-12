'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const mod=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/perpetual-sources.mjs')).href);
const candle=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/market-candles.mjs')).href);
const scanner=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/auto-scanner.mjs')).href);
const NOW=Date.UTC(2026,10,12,19,8),H=3600000,SECRET='s'.repeat(40);
function fixtures(n=330,interval=H){
 const start=Math.floor((NOW-8*60000)/H)*H-(n-1)*interval;
 return Array.from({length:n},(_,i)=>{
  const time=start+i*interval;
  const close=100+.06*i+Math.sin(i*1.25)*.38;
  const open=i?100+.06*(i-1)+Math.sin((i-1)*1.25)*.38:close-.12;
  return [time,String(open),String(Math.max(open,close)+.16),
   String(Math.min(open,close)-.16),String(close),'110','17777'];
 });
}
const bybit=(rows=fixtures())=>({retCode:0,retMsg:'OK',
 result:{category:'linear',symbol:'BTCUSDT',list:[...rows].reverse()}});
const okx=(rows=fixtures(300))=>({code:'0',data:[...rows].reverse().map(x=>[...x,'0','1'])});
const json=o=>new Response(JSON.stringify(o),{headers:{'content-type':'application/json'}});
test('Bybit exchange-validated USDT perpetual candles normalize newest-first data to chronological time',async()=>{
 const {getAlternativePerpetual}=await mod;
 const urls=[];
 const feed=await getAlternativePerpetual('BTCUSDT','1h',{limit:350,minBars:260,
  fetchFn:async url=>{urls.push(url);return json(bybit())}});
 assert.equal(feed.instrument,'perpetual');
 assert.equal(feed.source,'Bybit USDT linear perpetual');
 assert.equal(feed.exchange,'bybit');
 assert.equal(feed.quoteCurrency,'USDT');
 assert.equal(feed.bars.length,330);
 assert.match(urls[0],/category=linear&symbol=BTCUSDT&interval=60&limit=350/);
 assert.ok(feed.bars[0].time<feed.bars.at(-1).time);
 assert.equal(feed.bars[0].closeTime,feed.bars[0].time+H-1);
});
test('Bybit Spot or incorrect symbol is rejected, never relabeled as a perpetual',async()=>{
 const {getAlternativePerpetual}=await mod;
 let calls=0;
 await assert.rejects(getAlternativePerpetual('BTCUSDT','1h',{
  limit:350,minBars:260,venues:['bybit'],fetchFn:async()=>{
   calls++;return json({...bybit(),result:{...bybit().result,category:'spot'}});
  }
 }),/No independently verified/);
 assert.equal(calls,1);
 await assert.rejects(getAlternativePerpetual('BTCUSDT','1h',{
  limit:350,minBars:260,venues:['bybit'],fetchFn:async()=>{
   return json({...bybit(),result:{...bybit().result,symbol:'ETHUSDT'}});
  }
 }),/No independently verified/);
});
test('Fallback to OKX actual swap contract is source-labeled, includes contract-volume units',async()=>{
 const {getAlternativePerpetual}=await mod,urls=[];
 const feed=await getAlternativePerpetual('BTCUSDT','1h',{limit:300,minBars:260,
  fetchFn:async url=>{
   urls.push(url);
   if(url.includes('bybit'))return new Response('geo blocked',{status:403});
   if(url.includes('okx.com'))return json(okx());
   throw Error('Unexpected');
  }});
 assert.equal(urls.length,2);
 assert.match(urls[1],/instId=BTC-USDT-SWAP&bar=1H&limit=300/);
 assert.equal(feed.exchange,'okx');
 assert.match(feed.source,/OKX.*perpetual/);
 assert.equal(feed.volumeUnits,'contracts');
 assert.equal(feed.bars.length,300);
});
test('Malformed OHLC, duplicate timestamps and empty history are rejected at both venues',async()=>{
 const {getAlternativePerpetual}=await mod;
 for(const rows of [
  fixtures(330).map((r,i)=>i===4?[...r.slice(0,2),'999999999','0.001',...r.slice(4)]:r),
  fixtures(330).map((r,i)=>i===4?[...r.slice(0,1),...r.slice(1)]:r),
  fixtures(4)
 ]){
  // Force two consecutive identical timestamps in the second set.
  if(rows.length===330&&rows[4][0]===fixtures(330)[4][0]&&rows[4][2]!=='999999999')
   rows[4][0]=rows[3][0];
  await assert.rejects(getAlternativePerpetual('BTCUSDT','1h',{
   limit:350,minBars:260,venues:['bybit'],
   fetchFn:async()=>json(bybit(rows))
  }),/No independently verified/);
 }
});
test('Current futures ticker must belong to the exact source exchange and contract',async()=>{
 const {getPerpetualTicker}=await mod;
 const n=await getPerpetualTicker({exchange:'bybit'},'BTCUSDT',{fetchFn:async url=>{
  assert.match(url,/category=linear&symbol=BTCUSDT/);
  return json({retCode:0,result:{category:'linear',list:[{symbol:'BTCUSDT',lastPrice:'119.7'}]}});
 }});
 assert.equal(n,119.7);
 await assert.rejects(getPerpetualTicker({exchange:'bybit'},'BTCUSDT',{
  fetchFn:async()=>json({retCode:0,result:{category:'spot',list:[{symbol:'BTCUSDT',lastPrice:'1'}]}})
 }),/ticker instrument mismatch/);
 const p=await getPerpetualTicker({exchange:'okx'},'BTCUSDT',{fetchFn:async url=>{
  assert.match(url,/BTC-USDT-SWAP/);
  return json({code:'0',data:[{instId:'BTC-USDT-SWAP',last:'120.1'}]});
 }});
 assert.equal(p,120.1);
});
test('Public chart chooses source-identified USDT perpetual before USD spot fallback',async()=>{
 const {getCandles}=await candle;
 const res=await getCandles(new Request('https://staging.invalid/api/candles?market=crypto&symbol=BTCUSDT&interval=1h'),{
  now:()=>Date.UTC(2026,10,12,19,9),
  fetchFn:async url=>{
   if(url.includes('fapi.binance.com'))return new Response('blocked',{status:451});
   if(url.includes('api.bybit.com'))return json(bybit(fixtures(230)));
   throw Error('Unneeded provider called');
  }
 });
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.instrument,'perpetual');
 assert.match(body.source,/Bybit.*perpetual/);
 assert.equal(body.quoteCurrency,'USDT');
 assert.equal(body.aliasOnly,false);
 assert.match(body.quoteBasis,/Futures traded-market OHLC/);
 assert.ok(body.candles.length>=100);
});
test('Dry-run scanner can evaluate Bybit real-contract fixture with same-source ticker, never publishing it',async()=>{
 const {createAutoScanner}=await scanner,calls=[];
 const feed=fixtures(330),closing=Number(feed.at(-1)[4]);
 const engine=createAutoScanner({
  now:()=>NOW,cryptoSymbols:['BTCUSDT'],forexSymbols:[],
  researchHandler:async()=>json({coverage:'FULL_WEEK',checkedAt:new Date(NOW).toISOString(),events:[]}),
  fetchFn:async url=>{
   calls.push(url);
   if(url.includes('fapi.binance.com'))return new Response('restricted',{status:451});
   if(url.includes('/v5/market/kline'))return json(bybit(feed));
   if(url.includes('/v5/market/tickers'))return json({retCode:0,
    result:{category:'linear',list:[{symbol:'BTCUSDT',lastPrice:String(closing)}]}});
   throw Error('Unexpected network call');
  }
 });
 const result=await engine.run();
 assert.equal(result.status,'SCAN_COMPLETED');
 assert.equal(result.scanned,1);
 assert.equal(result.qualified,1);
 assert.equal(result.published,0);
 assert.equal(result.results[0].status,'CANDIDATE_UNPUBLISHED');
 assert.equal(calls.length,3);
 assert.doesNotMatch(JSON.stringify(result),/stopLoss|takeProfit|entry/);
});
test('Same venue rejects drifting live prices before counting a candidate',async()=>{
 const {createAutoScanner}=await scanner;
 const engine=createAutoScanner({now:()=>NOW,cryptoSymbols:['BTCUSDT'],forexSymbols:[],
  researchHandler:async()=>json({coverage:'FULL_WEEK',checkedAt:new Date(NOW).toISOString(),events:[]}),
  fetchFn:async url=>{
   if(url.includes('fapi.binance.com'))return new Response('blocked',{status:451});
   if(url.includes('/v5/market/kline'))return json(bybit());
   if(url.includes('/v5/market/tickers'))return json({retCode:0,
    result:{category:'linear',list:[{symbol:'BTCUSDT',lastPrice:'500'}]}});
   throw Error('Unexpected');
  }
 });
 const r=await engine.run();
 assert.equal(r.scanned,1);
 assert.equal(r.qualified,0);
 assert.equal(r.results[0].status,'PRICE_DRIFT');
 assert.equal(r.published,0);
});
