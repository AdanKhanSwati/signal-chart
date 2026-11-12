'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const mod=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/fx-daily-reference.mjs')).href);
const q=symbol=>new Request('https://test.example/api/fx-daily-reference?symbol='+symbol);
const now=Date.UTC(2026,10,12,12);
const rows=Array.from({length:40},(_,i)=>({date:new Date(now-(40-i)*86400000).toISOString().slice(0,10),
 base:'EUR',quote:'USD',rate:1.11+i*.0005}));
const json=o=>new Response(JSON.stringify(o),{headers:{'content-type':'application/json'}});
test('Daily FX fallback publishes actual daily points, never manufactured OHLC',async()=>{
 const {getFxDailyReferences}=await mod;
 const resp=await getFxDailyReferences(q('EURUSD'),{now:()=>now,fetchFn:async url=>{
  assert.match(url,/api\.frankfurter\.dev\/v2\/rates\?base=EUR&quotes=USD&from=/);
  return json(rows);
 }});
 assert.equal(resp.status,200);
 const data=await resp.json();
 assert.equal(data.instrument,'daily_reference');
 assert.equal(data.referenceOnly,true);
 assert.equal(data.granularity,'1d');
 assert.equal(data.points.length,40);
 assert.equal(data.points[0].rate,rows[0].rate);
 assert.ok(!('candles'in data));
 assert.ok(!('open'in data.points[0]));
 assert.match(data.note,/NOT live prices/);
});
test('FX reference cannot be requested for unlisted symbols or with POST',async()=>{
 const {getFxDailyReferences}=await mod;
 let called=0,fetchFn=async()=>{called++;return json(rows)};
 assert.equal((await getFxDailyReferences(q('XYZABC'),{fetchFn})).status,400);
 assert.equal((await getFxDailyReferences(new Request(q('USDCHF').url,{method:'POST'}),{fetchFn})).status,405);
 assert.equal(called,0);
});
test('Broken rate data or unavailable provider cannot become fake candles',async()=>{
 const {getFxDailyReferences}=await mod;
 for(const [symbol,data] of [
  ['GBPJPY',rows.slice(0,3).map(x=>({...x,base:'GBP',quote:'JPY'}))],
  ['NZDUSD',[...rows.map(x=>({...x,base:'NZD'})),{...rows[0],base:'NZD'}]]
 ]){
  const res=await getFxDailyReferences(q(symbol),{now:()=>now,fetchFn:async()=>json(data)});
  assert.equal(res.status,502);
  assert.ok(!('points'in await res.json()));
 }
 const bad=await getFxDailyReferences(q('EURJPY'),{now:()=>now,fetchFn:async()=>new Response('Unavailable',{status:503})});
 assert.equal(bad.status,502);
});
test('Cloudflare routes standalone daily references separately from missing forex candles',async()=>{
 const {createWorker}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
 const w=createWorker({fetchFn:async url=>{
  assert.match(url,/api\.frankfurter\.dev/);
  return json(rows);
 }});
 const response=await w.fetch(q('EURUSD'),{});
 assert.equal(response.status,200);
 assert.equal((await response.json()).referenceOnly,true);
});
