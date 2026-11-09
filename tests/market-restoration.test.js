'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler:quotes}=require('../api/quotes');
const {createHandler:detail}=require('../api/market-detail');
const {createHandler:research}=require('../api/research');
function response(){
 return {code:200,headers:{},body:null,
  setHeader(k,v){this.headers[k]=v;return this},
  status(v){this.code=v;return this},
  json(v){this.body=v;return this}};
}
async function request(handler,query,method='GET',headers={}){
 const res=response();
 await handler({method,query,headers},res);
 return res;
}
test('crypto quotes show only measured market prices, never premium trade details',async()=>{
 const at=Date.parse('2026-11-09T00:00:00Z');
 let count=0;
 const fetchFn=async()=>{count++;return {ok:true,json:async()=>[
  {symbol:'BTCUSDT',lastPrice:'75000',bidPrice:'74999',askPrice:'75001',priceChangePercent:'-2.4',highPrice:'76000',lowPrice:'74000',quoteVolume:'1200000',entry:75000},
  {symbol:'TRXUSDT',lastPrice:'0.3',bidPrice:'0.29',askPrice:'0.31',priceChangePercent:'1.2',highPrice:'0.32',lowPrice:'0.28',quoteVolume:'980000'}
 ]}};
 const h=quotes({fetchFn,clock:()=>at});
 const top=await request(h,{market:'crypto'});
 assert.equal(top.code,200);assert.deepEqual(Object.keys(top.body.quotes),['BTCUSDT']);
 assert.equal(top.body.quotes.BTCUSDT.price,75000);
 const all=await request(h,{market:'crypto',all:'1'});
 assert.equal(all.code,200);assert.ok(all.body.quotes.TRXUSDT,'all=1 must use a distinct cache key');
 assert.equal(count,2);
 assert.equal(JSON.stringify(all.body).includes('"entry"'),false);
 assert.equal(JSON.stringify(all.body).includes('stopLoss'),false);
});
test('forex quote source is explicitly indicative and does not invent spread or percent change',async()=>{
 const at=Date.parse('2026-11-09T11:00:00Z');
 const h=quotes({clock:()=>at,fetchFn:async()=>({ok:true,json:async()=>({
  result:'success',base_code:'USD',time_last_update_utc:'Mon, 09 Nov 2026 00:00:00 +0000',
  rates:{USD:1,EUR:0.85,GBP:0.75,JPY:150,PKR:280}})})});
 const x=await request(h,{market:'forex'});
 assert.equal(x.code,200);assert.equal(x.body.indicative,true);
 assert.ok(Math.abs(x.body.quotes.EURUSD.price-1/0.85)<0.000001);
 assert.equal(x.body.quotes.EURUSD.bid,null);assert.equal(x.body.quotes.EURUSD.ask,null);
 assert.equal(x.body.quotes.EURUSD.changePercent,null);
 assert.equal(x.body.quotes.USDPKR.price,280);
});
test('failed real-time provider has no invented fallback quote',async()=>{
 const h=quotes({fetchFn:async()=>{throw Error('down')}});
 const x=await request(h,{market:'crypto'});
 assert.equal(x.code,503);assert.equal(x.body.quotes,undefined);
});
test('catalog mode delegates to verified market catalog without premium content',async()=>{
 const h=quotes({catalog:async(_r,res)=>res.status(200).json({crypto:[{symbol:'BTCUSDT'}],forex:[]})});
 const x=await request(h,{mode:'catalog'});
 assert.equal(x.code,200);assert.equal(x.body.crypto[0].symbol,'BTCUSDT');
 assert.equal((await request(h,{market:'invalid'})).code,400);
 assert.equal((await request(h,{market:'crypto'},'POST')).code,405);
});
test('market-detail returns OHLC and nonactionable indicators only',async()=>{
 const h=detail({candles:async(_req,res)=>{
  const candles=Array.from({length:30},(_,i)=>({time:1700000000+i*86400,open:100+i,high:103+i,low:99+i,close:101+i,volume:2000+i,entry:0,stopLoss:0,target:0}));
  return res.status(200).json({symbol:'BTCUSDT',market:'crypto',interval:'1d',source:'Mocked Binance closed candles',
   quoteBasis:'Exchange OHLC',asof:'2026-11-09T00:00:00Z',candles});
 }});
 const x=await request(h,{symbol:'BTCUSDT'});
 assert.equal(x.code,200);assert.equal(x.body.candles.length,30);
 assert.ok(Number.isFinite(x.body.stats.rsi14));
 assert.deepEqual(Object.keys(x.body.stats).sort(),['changePercent','high','low','rsi14','sma20','sma50','volume'].sort());
 assert.equal(JSON.stringify(x.body).includes('"entry"'),false);
 assert.equal(JSON.stringify(x.body).includes('stopLoss'),false);
 assert.equal(JSON.stringify(x.body).includes('"target"'),false);
});
test('invalid candle provider responses do not expose underlying details',async()=>{
 const h=detail({candles:async(_req,res)=>res.status(502).json({error:'Unavailable',detail:'private upstream host'})});
 const x=await request(h,{symbol:'BTCUSDT'});
 assert.equal(x.code,502);assert.equal(x.body.detail,undefined);
});
function researchFixture(status='trial'){
 let requests=0;
 const h=research({
  calendar:{snapshot:async()=>({coverage:'FULL_WEEK',events:[],providers:{},checkedAt:'2026-11-09T00:00:00Z'}),
   assess:()=>({decision:'CLEAR',blocked:false,events:[]})},
  news:{latest:async()=>({headlines:[],checkedAt:'2026-11-09T00:00:00Z'})},
  backtest:{run:async()=>{requests++;return {status:'HISTORICAL_SIMULATION_ONLY',auditStatus:'NOT_EXTERNALLY_VERIFIED'}}},
  core:{identity:async()=>({uid:'11111111-1111-4111-8111-111111111111'}),
   member:async()=>({status,isAdmin:false})}
 });
 return {h,calls:()=>requests};
}
test('research health never claims unverified unattended hourly signal publishing',async()=>{
 const x=researchFixture();
 const res=await request(x.h,{mode:'health'});
 assert.equal(res.code,200);assert.equal(res.body.unattendedPublishing.enabled,false);
 assert.equal(res.body.unattendedPublishing.status,'NOT_READY');
 assert.equal(x.calls(),0);
});
test('news and calendar stay public as source-attributed free analytics',async()=>{
 const x=researchFixture();
 const cal=await request(x.h,{mode:'calendar',symbol:'EURUSD'});
 assert.equal(cal.code,200);assert.equal(cal.body.coverage,'FULL_WEEK');assert.ok(cal.body.news);
 assert.equal(cal.body.assessment.blocked,false);
 const news=await request(x.h,{mode:'news'});assert.equal(news.code,200);
});
test('trial cannot obtain unlimited strategy backtests to bypass three-signal credit',async()=>{
 const x=researchFixture('trial');
 const res=await request(x.h,{mode:'backtest',symbol:'BTCUSDT'});
 assert.equal(res.code,403);assert.equal(x.calls(),0);
});
test('paid customer can perform attributed historical diagnostic simulations',async()=>{
 const x=researchFixture('active');
 const res=await request(x.h,{mode:'backtest',symbol:'BTCUSDT'});
 assert.equal(res.code,200);assert.equal(res.body.auditStatus,'NOT_EXTERNALLY_VERIFIED');
 assert.equal(x.calls(),1);
});

test('Binance block uses independent Kraken spot data, clearly labeled and never futures',async()=>{
 const h=quotes({fetchFn:async url=>{
  if(url.includes('binance'))return {ok:false,status:451};
  if(url.includes('kraken'))return {ok:true,json:async()=>({error:[],result:{
   XXBTZUSD:{c:['74900'],a:['74901'],b:['74899'],h:['75200','75400'],
     l:['74500','74200'],v:['100','300']}
  }})};
  throw Error('Unexpected provider')},clock:()=>Date.parse('2026-11-09T00:00:00Z')});
 const out=await request(h,{market:'crypto'});
 assert.equal(out.code,200);assert.equal(out.body.indicative,true);
 assert.equal(out.body.quotes.BTCUSDT.price,74900);
 assert.equal(out.body.quotes.BTCUSDT.quoteCurrency,'USD');
 assert.equal(out.body.quotes.BTCUSDT.aliasOnly,true);
 assert.match(out.body.quotes.BTCUSDT.source,/NOT USDT futures/);
 assert.equal(out.body.quotes.BTCUSDT.changePercent,null);
 assert.doesNotMatch(out.body.notice,/guaranteed executable order fills/);
});
test('Coinbase historical spot candle fallback supports analytics without pretending futures',async()=>{
 const base=Date.parse('2026-11-09T00:00:00Z')/1000;
 const rows=Array.from({length:35},(_,i)=>[base-i*86400,100+i,105+i,101+i,103+i,1300+i]);
 const h=detail({
  candles:async(_req,res)=>res.status(502).json({error:'Binance geo-blocked'}),
  fetchFn:async u=>{
   assert.match(u,/api\.exchange\.coinbase\.com\/products\/BTC-USD\/candles/);
   return {ok:true,json:async()=>rows};
  }
 });
 const r=await request(h,{market:'crypto',symbol:'BTCUSDT',interval:'1d'});
 assert.equal(r.code,200);
 assert.equal(r.body.candles.length,35);
 assert.equal(r.body.quoteCurrency,'USD');
 assert.equal(r.body.aliasOnly,true);
 assert.match(r.body.quoteBasis,/not executable USDT futures/);
 assert.match(r.body.source,/Coinbase Exchange USD spot/);
 assert.equal(JSON.stringify(r.body).includes('"entry"'),false);
});
test('invalid or unsupported Coinbase fallback cannot fabricate crypto OHLC',async()=>{
 const h=detail({candles:async(_req,res)=>res.status(502).json({error:'Both feeds unavailable'}),
  fetchFn:async()=>{throw Error('Coinbase unavailable')}});
 const x=await request(h,{market:'crypto',symbol:'BTCUSDT',interval:'1d'});
 assert.equal(x.code,502);assert.equal(x.body.candles,undefined);
});
