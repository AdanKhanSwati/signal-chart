'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluate,createAutoEngine,validateBars,STRATEGY}=require('../lib/sc-auto-engine');
const {createHandler,authorized}=require('../api/auto-signals');
const {createHmac}=require('node:crypto');
function sign(secret,now){const timestamp=String(Math.floor(now/1000));return {method:'POST',headers:{'x-sc-timestamp':timestamp,'x-sc-signature':createHmac('sha256',secret).update(timestamp+'.{}').digest('hex')}};}
const H=3600000;
function fixture(now,n=330,market='crypto'){
 const aligned=Math.floor((now-8*60000)/H)*H;
 const first=aligned-(n-1)*H;
 return Array.from({length:n},(_,i)=>{
  const close=100+0.06*i+Math.sin(i*1.25)*.38;
  const open=i?100+0.06*(i-1)+Math.sin((i-1)*1.25)*.38:close-.12;
  const high=Math.max(open,close)+.16,low=Math.min(open,close)-.16;
  return{time:first+i*H,closeTime:first+(i+1)*H-1,open,high,low,close,
   volume:100+5*Math.sin(i)};
 });
}
function response(){
 return{code:200,headers:{},data:null,setHeader(k,v){this.headers[k]=v;return this},
  status(v){this.code=v;return this},json(v){this.data=v;return this}};
}
test('hourly signal scan fails closed without enough verified closed candles',()=>{
 const now=Date.UTC(2026,10,9,19,8);
 assert.throws(()=>validateBars([],now),/Not enough/);
 assert.throws(()=>validateBars(fixture(now,330).map(b=>({...b,time:b.time-4*H,closeTime:b.closeTime-4*H})),now),/Stale/);
});
test('strategy cannot publish a signal merely because its price is trending',()=>{
 const now=Date.UTC(2026,10,9,19,8);
 const bars=fixture(now);
 const x=evaluate('BTCUSDT','crypto',bars,now);
 assert.equal(x.status,'CANDIDATE');
 assert.equal(x.direction,'LONG');
 assert.ok(x.entry>x.stopLoss);
 assert.ok(x.takeProfit>x.entry);
 assert.equal(x.evidence.signalScore,8.5);
 assert.equal(STRATEGY,'sc-hourly-ema-breakout-v1');
});
test('unknown macro calendar coverage blocks the whole automatic run',async()=>{
 let fetches=0,published=0;
 const x=createAutoEngine({
  fetchFn:async()=>{fetches++;throw Error('should never fetch')},
  calendar:{snapshot:async()=>({coverage:'UNKNOWN'})},
  publisher:async()=>{published++}
 });
 const res=await x.run({publish:true});
 assert.equal(res.status,'BLOCKED_NEWS_DATA');
 assert.equal(res.scanned,0);assert.equal(fetches,0);assert.equal(published,0);
});
test('missing provider candles create no signal and cannot trigger publication',async()=>{
 let publishes=0;
 const engine=createAutoEngine({
  fetchFn:async()=>{throw Error('Provider offline')},
  calendar:{snapshot:async()=>({coverage:'FULL_WEEK'}),assess:()=>({blocked:false,decision:'CLEAR'})},
  cryptoSymbols:['BTCUSDT'],fxSymbols:['EURUSD'],
  publisher:async()=>{publishes++;return{published:true}}
 });
 const result=await engine.run({publish:true});
 assert.equal(result.scanned,2);assert.equal(result.published,0);
 assert.equal(result.counts.DATA_UNAVAILABLE,2);assert.equal(publishes,0);
});
test('automation route accepts only recent HMAC-signed scheduler calls',async()=>{
 const pass='a'.repeat(40),now=Date.UTC(2026,10,9,19,8);
 const req=sign(pass,now);
 assert.equal(authorized(req,pass,now),true);
 assert.equal(authorized(req,'b'.repeat(40),now),false);
 assert.equal(authorized(req,pass,now+190000),false,'expired signed calls are rejected');
 assert.equal(authorized({headers:{...req.headers,'x-sc-signature':'0'.repeat(64)}},pass,now),false);
 const h=createHandler({env:{SC_AUTO_CRON_SECRET:pass,SC_AUTO_PUBLISH_ENABLED:'false'},now:()=>now});
 let r=response();await h({method:'GET',headers:req.headers},r);assert.equal(r.code,405);
 r=response();await h({method:'POST',headers:{}},r);assert.equal(r.code,401);
 r=response();await h(req,r);assert.equal(r.code,503);
});
test('authenticated enabled automation executes and records an auditable run',async()=>{
 const pass='a'.repeat(40),calls=[];
 const gate={rpc:async(name,args)=>{calls.push({name,args});return{published:true}}};
 const engineFactory=options=>({
  async run(input){
   assert.equal(input.publish,true);
   assert.equal(options.allowIndicativeForex,false);
   const result=await options.publisher({signalKey:'crypto:BTCUSDT:1794250800000:long',
    market:'crypto',symbol:'BTCUSDT',source:'Binance USD-M Futures',
    candleClosedAt:'2026-11-09T19:00:00.000Z',analysis:{direction:'LONG'}});
   assert.equal(result.published,true);
   return {status:'COMPLETED',scanned:2,qualified:1,published:1,
    errors:0,counts:{PUBLISHED:1,NO_SETUP:1}};
  }
 });
 const h=createHandler({env:{SC_AUTO_CRON_SECRET:pass,SC_AUTO_PUBLISH_ENABLED:'true'},
  makeGateway:()=>gate,engineFactory,now:()=>Date.UTC(2026,10,9,19,8)});
 const r=response();
 await h(sign(pass,Date.UTC(2026,10,9,19,8)),r);
 assert.equal(r.code,200);assert.equal(r.data.published,1);
 assert.deepEqual(calls.map(x=>x.name),['sc_publish_automatic_signal','sc_record_auto_scan']);
 assert.equal(r.headers['Cache-Control'],'no-store, private');
});

test('USD spot fallback is labeled correctly and never presented as Binance futures',async()=>{
 const now=Date.UTC(2026,10,9,19,8);
 const bars=fixture(now,330);
 const feed=(url)=>{
  if(url.includes('fapi.binance.com'))return {ok:false,status:451,json:async()=>({})};
  if(url.includes('/OHLC?'))return {ok:true,json:async()=>({error:[],result:{XXBTZUSD:bars.map(b=>[
   Math.round(b.time/1000),String(b.open),String(b.high),String(b.low),String(b.close),
   String(b.close),String(b.volume),13
  ]),last:0}})};
  if(url.includes('/Ticker?'))return {ok:true,json:async()=>({error:[],result:{XXBTZUSD:{c:[String(bars.at(-2).close)]}}})};
  throw Error('Unexpected provider path '+url);
 };
 const scanner=createAutoEngine({
  now:()=>now,
  fetchFn:async url=>feed(url),
  calendar:{snapshot:async()=>({coverage:'FULL_WEEK'}),assess:()=>({decision:'CLEAR',blocked:false})},
  cryptoSymbols:['BTCUSDT'],fxSymbols:[]
 });
 const candidate=await scanner.scanOne('crypto','BTCUSDT',{coverage:'FULL_WEEK'});
 assert.equal(candidate.status,'QUALIFIED');
 assert.equal(candidate.asset,'BTCUSD');
 assert.equal(candidate.source,'Kraken USD spot');
 assert.equal(candidate.analysis.executionBasis,'EXCHANGE_SPOT_USD_REFERENCE');
 assert.equal(candidate.signalKey.split(':')[1],'BTCUSD');
 assert.ok(!candidate.signalKey.includes('BTCUSDT'));
});
test('natural forex weekend gap does not masquerade as bad market data',()=>{
 const now=Date.UTC(2026,10,9,19,8),bars=fixture(now,330,'forex');
 const weekend=bars.map((b,i)=>i<310?{...b,time:b.time-48*H,closeTime:b.closeTime-48*H}:b);
 assert.throws(()=>validateBars(weekend,now,'crypto'),/Discontinuous/);
 assert.ok(validateBars(weekend,now,'forex').length>=260);
});
