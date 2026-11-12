'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runSmoke,endpoints}=require('../scripts/check-live-staging.cjs');
const response=(data,status=200,contentType='application/json')=>new Response(
 contentType==='text/html'?data:JSON.stringify(data),
 {status,headers:{'content-type':contentType}}
);
test('Live staging smoke performs only public GET checks, including launch and both markets',()=>{
 assert.ok(endpoints.some(x=>x.id==='rootLanding'));
 assert.ok(endpoints.some(x=>x.id==='cryptoBTC'));
 assert.ok(endpoints.some(x=>x.id==='forexEUR'));
 assert.ok(endpoints.every(x=>x.path.startsWith('/')&&!/unlock|checkout|payment|admin|trial/.test(x.path)));
});
test('Healthy research staging still requires launch gates to be passed independently',async()=>{
 const seen=[];
 const r=await runSmoke({fetchFn:async(url,opts)=>{
  seen.push({url,opts});
  if(url.endsWith('/api/ready'))return response({productionReady:false},503);
  if(url.endsWith('/api/health'))return response({ok:true});
  if(url.includes('/api/markets'))return response({markets:Array.from({length:75},()=>({symbol:'BTCUSDT'}))});
  if(url.includes('/api/candles'))return response({source:'Bybit USDT linear perpetual',instrument:'perpetual',exchange:'bybit',
   candles:Array.from({length:24},()=>({time:1700000000,open:1,high:1,low:1,close:1}))});
  return response('<html><title>SignalChart</title><h1>The chart<br>comes</h1></html>',200,'text/html');
 }});
 assert.equal(r.verdict,'PUBLIC_SMOKE_PASSED');
 assert.equal(r.passed,endpoints.length);
 assert.ok(seen.every(x=>x.url.startsWith('https://signal-chart.auxwork3.workers.dev/')&&x.opts.method==='GET'));
});
test('Old deployment and forex 502 are reported, not hidden by green source tests',async()=>{
 const r=await runSmoke({fetchFn:async url=>{
  if(url.endsWith('/api/ready'))return response({productionReady:false},503);
  if(url.includes('EURUSD'))return response({error:'offline'},502);
  if(url.endsWith('/'))return response('<title>SignalChart old dashboard</title>',200,'text/html');
  if(url.includes('launch.html'))return response('not found',404,'text/html');
  if(url.includes('/api/health'))return response({ok:true});
  if(url.includes('/api/markets'))return response({markets:Array.from({length:51},()=>({}))});
  if(url.includes('/api/candles'))return response({source:'exchange',candles:Array.from({length:25},()=>({})),instrument:'perpetual'});
  return response('<title>SignalChart mobile</title>',200,'text/html');
 }});
 assert.equal(r.verdict,'STAGING_REQUIRES_ATTENTION');
 assert.ok(r.checks.find(x=>x.id==='rootLanding').result==='OLD_DEPLOYMENT');
 assert.ok(r.checks.find(x=>x.id==='forexEUR').result==='UNEXPECTED_HTTP');
});

test('USD spot-reference crypto data cannot certify perpetual staging readiness',async()=>{
 const r=await runSmoke({fetchFn:async url=>{
  if(url.endsWith('/api/ready'))return response({productionReady:false},503);
  if(url.endsWith('/api/health'))return response({ok:true});
  if(url.includes('/api/markets'))return response({markets:Array.from({length:77},()=>({symbol:'BTCUSDT'}))});
  if(url.includes('/api/candles'))return response({
   source:'Coinbase Exchange USD spot reference (NOT USDT futures)',
   instrument:'spot_reference',exchange:'coinbase',aliasOnly:true,
   candles:Array.from({length:24},(_,i)=>({time:1700000000+i*3600,open:1,high:1,low:1,close:1}))
  });
  return response('<title>SignalChart</title><h1>See the market.</h1>',200,'text/html');
 }});
 assert.equal(r.verdict,'STAGING_REQUIRES_ATTENTION');
 assert.equal(r.checks.find(x=>x.id==='cryptoBTC').result,'REFERENCE_ONLY');
 assert.equal(r.checks.find(x=>x.id==='cryptoADA').result,'REFERENCE_ONLY');
 assert.equal(r.checks.find(x=>x.id==='forexEUR').result,'PASS');
});
