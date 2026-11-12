'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const bridge=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/calendar-bridge.mjs')).href);
const scanner=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/auto-scanner.mjs')).href);
const NOW=Date.UTC(2026,10,12,19,8),H=3600000;
const env={
 SUPABASE_URL:'https://nnailvcgaupjtdaxvjsx.supabase.co',
 SUPABASE_SECRET_KEY:'sb_secret_'+'a'.repeat(36),
 SC_AUTO_RESEARCH_ENABLED:'true'
};
function data(events=[]){
 return {coverage:'SINGLE_SOURCE_WEEKLY',sourceStatus:'CURRENT',
  checkedAt:new Date(NOW-30000).toISOString(),
  independentlyVerified:false,publicationApproved:false,
  events:events.length?events:[{source:'Forex Factory weekly calendar',
   title:'ECB Monetary Policy Statement',currency:'EUR',impact:'high',
   scheduledAt:new Date(NOW+86400000).toISOString()}]};
}
const json=o=>new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}});
function candles(){
 const aligned=Math.floor((NOW-8*60000)/H)*H,first=aligned-329*H;
 return Array.from({length:330},(_,i)=>{
  const close=100+.06*i+Math.sin(i*1.25)*.38;
  const open=i?100+.06*(i-1)+Math.sin((i-1)*1.25)*.38:close-.12;
  const high=Math.max(open,close)+.16,low=Math.min(open,close)-.16;
  const time=first+i*H;
  return [time,String(open),String(high),String(low),String(close),
   '100',time+H-1];
 });
}
test('Worker calendar bridge verifies private credentials and only uses authorized fixed Supabase RPC',async()=>{
 const {readWeeklyCalendar}=await bridge;let count=0;
 const snapshot=await readWeeklyCalendar(async(url,options)=>{
  count++;assert.equal(url,env.SUPABASE_URL+'/rest/v1/rpc/sc_economic_calendar_snapshot');
  assert.equal(options.method,'POST');
  assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);
  assert.equal(options.headers.Authorization,undefined);
  assert.equal(options.body,'{}');
  return json(data());
 },env,{now:()=>NOW});
 assert.equal(count,1);
 assert.equal(snapshot.coverage,'SINGLE_SOURCE_WEEKLY');
 assert.equal(snapshot.publicationApproved,false);
 assert.equal(snapshot.independentlyVerified,false);
 assert.equal(snapshot.events.length,1);
 assert.deepEqual(Object.keys(snapshot.events[0]).sort(),
  ['currency','impact','scheduledAt']);
});
test('Bridge refuses publishable/anonymous keys, stale snapshots, forged verification and malformed macro events',async()=>{
 const {readWeeklyCalendar}=await bridge;
 let calls=0;
 const missing=await readWeeklyCalendar(async()=>{calls++;throw Error('Network must not run')},{
  ...env,SUPABASE_SECRET_KEY:'',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_X'
 },{now:()=>NOW});
 assert.equal(missing,null);assert.equal(calls,0);
 const bad=[
  {...data(),checkedAt:new Date(NOW-2*H).toISOString()},
  {...data(),publicationApproved:true},
  {...data(),independentlyVerified:true},
  {...data(),coverage:'FULL_WEEK'},
  {...data(),events:[{currency:'USD',impact:'high',title:'CPI',
   source:'unknown',scheduledAt:new Date(NOW).toISOString()}]},
  {...data(),events:[{currency:'USD',impact:'medium',title:'CPI',
   source:'Forex Factory weekly calendar',
   scheduledAt:new Date(NOW+15*86400000).toISOString()}]}
 ];
 for(const payload of bad){
  const out=await readWeeklyCalendar(async()=>json(payload),env,{now:()=>NOW});
  assert.equal(out,null);
 }
});
test('Real-source private calendar bridge allows technical dry runs but never qualifies single-source news for publication',async()=>{
 const {createAutoScanner}=await scanner;
 const rows=candles(),ticker=rows.at(-2)[4],calls=[];
 const engine=createAutoScanner({now:()=>NOW,cryptoSymbols:['BTCUSDT'],
  forexSymbols:[],fetchFn:async(url,options)=>{
   calls.push(url);
   if(url.endsWith('/rpc/sc_economic_calendar_snapshot'))
    return json(data());
   if(url.includes('/fapi/v1/klines?'))return json(rows);
   if(url.includes('/fapi/v1/ticker/price?'))
    return json({symbol:'BTCUSDT',price:ticker});
   throw Error('Unexpected upstream '+url);
  }});
 const result=await engine.run({env});
 assert.equal(result.scanned,1);
 assert.equal(result.qualified,0);
 assert.equal(result.researchOnlyCandidates,1);
 assert.equal(result.newsCoverage,'SINGLE_SOURCE_WEEKLY');
 assert.equal(result.publicationReady,false);
 assert.equal(result.published,0);
 assert.equal(result.results[0].status,'CANDIDATE_NEWS_UNVERIFIED');
 assert.equal(calls.length,3);
 assert.doesNotMatch(JSON.stringify(result),/entry|stopLoss|takeProfit|signalKey|secret/i);
});
test('High-impact event near a signal blocks even an unverified single-source candidate',async()=>{
 const {createAutoScanner}=await scanner;
 const event={source:'Forex Factory weekly calendar',title:'Nonfarm Payrolls',
  currency:'USD',impact:'high',scheduledAt:new Date(NOW+25*60000).toISOString()};
 const engine=createAutoScanner({now:()=>NOW,cryptoSymbols:['BTCUSDT'],
  forexSymbols:[],fetchFn:async url=>{
   if(url.endsWith('/rpc/sc_economic_calendar_snapshot'))
    return json(data([event]));
   if(url.includes('/fapi/v1/klines?'))return json(candles());
   if(url.includes('/fapi/v1/ticker/price?'))
    throw Error('Live quote should never be requested when news blocks entry');
   throw Error('Unexpected request');
  }});
 const out=await engine.run({env});
 assert.equal(out.scanned,1);
 assert.equal(out.qualified,0);
 assert.equal(out.researchOnlyCandidates,0);
 assert.equal(out.results[0].status,'NEWS_BLOCK');
 assert.equal(out.published,0);
});
