'use strict';
/**
 * SignalChart unattended research scanner.
 * Deterministic closed-candle strategy; neither fabricated price feeds nor
 * prediction probabilities. Publication is delegated to a locked DB RPC.
 */
const HOUR=3600000;
const CRYPTO=Object.freeze(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','ADAUSDT','LINKUSDT']);
const FX=Object.freeze({EURUSD:'EURUSD=X',GBPUSD:'GBPUSD=X',USDJPY:'JPY=X'});
const STRATEGY='sc-hourly-ema-breakout-v1';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const avg=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const round=n=>Number(n.toPrecision(9));
const validBar=b=>b&&[b.time,b.closeTime,b.open,b.high,b.low,b.close].every(finite)&&
 b.time<b.closeTime&&b.open>0&&b.close>0&&b.low>0&&b.high>=Math.max(b.open,b.close,b.low)&&
 b.low<=Math.min(b.open,b.close,b.high)&&b.volume>=0;
function ema(vals,n){
 const k=2/(n+1);let v=vals[0];
 for(const price of vals.slice(1))v=price*k+v*(1-k);
 return v;
}
function rsi(bars,n=14){
 const last=bars.slice(-n-1),up=[],down=[];
 for(let i=1;i<last.length;i++){const diff=last[i].close-last[i-1].close;up.push(Math.max(diff,0));down.push(Math.max(-diff,0))}
 if(up.length!==n)return null;
 const g=avg(up),l=avg(down);
 return l===0?(g===0?50:100):100-100/(1+g/l);
}
function atr(bars,n=14){
 const last=bars.slice(-n-1);
 if(last.length!==n+1)return null;
 const values=[];
 for(let i=1;i<last.length;i++){
  const b=last[i],p=last[i-1];
  values.push(Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close)));
 }
 return avg(values);
}
function completed4h(bars){
 const by=new Map();
 for(const b of bars){
  const start=Math.floor(b.time/(4*HOUR))*(4*HOUR);
  const set=by.get(start)||[];
  set.push(b);by.set(start,set);
 }
 return [...by.entries()].filter(([start,bs])=>
  bs.length===4&&bs.every((b,i)=>b.time===start+i*HOUR&&b.closeTime<=start+4*HOUR))
  .map(([start,bs])=>({time:start,closeTime:start+4*HOUR-1,open:bs[0].open,
   high:Math.max(...bs.map(x=>x.high)),low:Math.min(...bs.map(x=>x.low)),
   close:bs[3].close,volume:bs.reduce((s,b)=>s+b.volume,0)}))
  .sort((a,b)=>a.time-b.time);
}
function validateBars(rows,now){
 if(!Array.isArray(rows))throw Error('Candle data unavailable');
 const bars=rows.filter(validBar).filter(b=>b.closeTime<=now-60000)
  .sort((a,b)=>a.time-b.time).filter((b,i,a)=>i===0||b.time!==a[i-1].time);
 if(bars.length<260)throw Error('Not enough verified completed candles');
 const last=bars.at(-1);
 if(now-last.closeTime>30*60000||last.closeTime>now-60000)
  throw Error('Stale or unclosed market candle');
 if(bars.slice(-55).some((b,i,a)=>i>0&&b.time-a[i-1].time!==HOUR))
  throw Error('Discontinuous hourly candles');
 return bars;
}
function evaluate(symbol,market,rows,now){
 const bars=validateBars(rows,now),b=bars.at(-1),higher=completed4h(bars);
 if(higher.length<50)throw Error('Insufficient completed four-hour trend data');
 const hh=higher.at(-1),window=bars.slice(-80),higherWindow=higher.slice(-80);
 const closes=window.map(x=>x.close),higherCloses=higherWindow.map(x=>x.close);
 const fast=ema(closes,20),slow=ema(closes,50),hfast=ema(higherCloses,20),hslow=ema(higherCloses,50);
 const momentum=rsi(bars),vol=atr(bars),pct=vol/b.close*100;
 const prior=bars.slice(-13,-1);
 const top=Math.max(...prior.map(x=>x.high)),bottom=Math.min(...prior.map(x=>x.low));
 const long=fast>slow&&hfast>hslow&&b.close>fast&&b.close>top&&momentum>=52&&momentum<=69;
 const short=fast<slow&&hfast<hslow&&b.close<fast&&b.close<bottom&&momentum>=31&&momentum<=48;
 const direction=long?'LONG':short?'SHORT':null;
 const acceptableVol=market==='crypto'?(pct>=.18&&pct<=4.5):(pct>=.015&&pct<=1.1);
 const averageVolume=market==='crypto'?avg(bars.slice(-21,-1).map(x=>x.volume)):null;
 const volumeOK=market!=='crypto'||b.volume>=averageVolume*.85;
 if(!direction||!acceptableVol||!volumeOK)return {status:'NO_SETUP',symbol,market};
 const entry=round(b.close),stopLoss=round(entry+(long?-1:1)*vol*1.5),
  takeProfit=round(entry+(long?1:-1)*vol*3);
 if([entry,stopLoss,takeProfit].some(x=>!finite(x)||x<=0))
  return {status:'NO_SETUP',symbol,market};
 const evidence={
  strategy:STRATEGY,ema20:round(fast),ema50:round(slow),
  ema20h4:round(hfast),ema50h4:round(hslow),
  rsi14:round(momentum),atr14:round(vol),
  atrPercent:round(pct),breakoutBars:12,volumeRatio:averageVolume?round(b.volume/averageVolume):null,
  riskReward:2,signalScore:8.5,signalScoreMax:8.5,
  note:'Strategy rule score, NOT a probability of profit; live performance is unverified.'
 };
 return {status:'CANDIDATE',symbol,market,direction,entry,stopLoss,takeProfit,
  candleClosedAt:new Date(b.closeTime).toISOString(),atr:vol,evidence};
}
async function requestJSON(url,fetchFn){
 const response=await fetchFn(url,{cache:'no-store',headers:{Accept:'application/json',
  'User-Agent':'SignalChart-AutomatedResearch/1.0'},signal:AbortSignal.timeout(9500)});
 if(!response.ok)throw Error('Market data service unavailable');
 return response.json();
}
async function loadCrypto(symbol,fetchFn,now){
 const url='https://fapi.binance.com/fapi/v1/klines?symbol='+symbol+'&interval=1h&limit=350';
 const rows=await requestJSON(url,fetchFn);
 if(!Array.isArray(rows))throw Error('Invalid futures candles');
 const bars=rows.map(v=>({time:Number(v[0]),closeTime:Number(v[6]),
  open:Number(v[1]),high:Number(v[2]),low:Number(v[3]),close:Number(v[4]),volume:Number(v[5])}));
 return{bars,source:'Binance USD-M Futures',referenceUrl:'https://www.binance.com/en/futures/'+symbol,
  async freshPrice(){const d=await requestJSON('https://fapi.binance.com/fapi/v1/ticker/price?symbol='+symbol,fetchFn);
   const price=Number(d.price);if(!finite(price)||price<=0)throw Error('No verified live market price');
   return price;}};
}
async function loadForex(symbol,fetchFn){
 const ticker=FX[symbol];if(!ticker)throw Error('Unsupported FX symbol');
 const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(ticker)+'?range=60d&interval=60m';
 const result=await requestJSON(url,fetchFn),entry=result?.chart?.result?.[0],q=entry?.indicators?.quote?.[0];
 if(!Array.isArray(entry?.timestamp)||!q)throw Error('No valid indicative FX candles');
 const bars=entry.timestamp.map((t,i)=>({time:Number(t)*1000,closeTime:Number(t)*1000+HOUR-1,
  open:Number(q.open?.[i]),high:Number(q.high?.[i]),low:Number(q.low?.[i]),
  close:Number(q.close?.[i]),volume:0}));
 return{bars,source:'Yahoo Finance indicative',
  referenceUrl:'https://finance.yahoo.com/quote/'+encodeURIComponent(ticker),
  freshPrice:null};
}
function createAutoEngine({fetchFn=globalThis.fetch,calendar=require('./sc-economic'),
 now=()=>Date.now(),publisher=null,
 cryptoSymbols=CRYPTO,fxSymbols=Object.keys(FX),
 allowIndicativeForex=false}={}){
 async function scanOne(market,symbol,events){
  const time=now();
  const feed=market==='crypto'?await loadCrypto(symbol,fetchFn,time):await loadForex(symbol,fetchFn);
  const setup=evaluate(symbol,market,feed.bars,time);
  if(setup.status!=='CANDIDATE')return {status:'NO_SETUP',market,symbol};
  const eventRisk=calendar.assess(events,symbol,time);
  if(!eventRisk||eventRisk.blocked||eventRisk.decision!=='CLEAR')
   return {status:'NEWS_BLOCK',market,symbol};
  if(market==='forex'&&!allowIndicativeForex)
   return {status:'INDICATIVE_ONLY',market,symbol};
  if(feed.freshPrice){
   const livePrice=await feed.freshPrice();
   if(Math.abs(livePrice-setup.entry)>setup.atr*.20)
    return {status:'PRICE_DRIFT',market,symbol};
  }
  const candleToken=String(Date.parse(setup.candleClosedAt));
  const signalKey=market+':'+symbol+':'+candleToken+':'+setup.direction.toLowerCase();
  const analysis={
   direction:setup.direction,entry:setup.entry,stopLoss:setup.stopLoss,takeProfit:setup.takeProfit,
   timeframe:'1h',riskPercent:0.5,riskReward:2,
   strategy:STRATEGY,source:feed.source,candleClosedAt:setup.candleClosedAt,
   executionBasis:market==='forex'?'INDICATIVE_NOT_BROKER':'EXCHANGE_FUTURES_REFERENCE',
   auditStatus:'UNVERIFIED_LIVE_PERFORMANCE',
   research:'Completed hourly breakout with EMA20/EMA50 alignment on 1h and 4h, RSI14 momentum confirmation, ATR14 volatility filter, and macroeconomic event clearance. Entry refers to a completed candle; actual execution may differ, and the stop does not guarantee a fill.',
   evidenceUrl:feed.referenceUrl,indicators:setup.evidence,
   newsCoverage:events.coverage,newsDecision:eventRisk.decision
  };
  return {status:'QUALIFIED',market,symbol,signalKey,source:feed.source,
   candleClosedAt:setup.candleClosedAt,analysis};
 }
 async function run({publish=false}={}){
  if(!publisher&&publish)throw Error('Server-side signal publisher not configured');
  const eventData=await calendar.snapshot();
  if(!eventData||eventData.coverage!=='FULL_WEEK')
   return {status:'BLOCKED_NEWS_DATA',scanned:0,published:0,errors:0,
    note:'Economic calendar is missing verified full-week coverage. Fail closed.'};
  const symbols=[...cryptoSymbols.map(symbol=>({market:'crypto',symbol})),
   ...fxSymbols.map(symbol=>({market:'forex',symbol}))];
  const rows=[],batchSize=4;
  for(let i=0;i<symbols.length;i+=batchSize){
   const out=await Promise.all(symbols.slice(i,i+batchSize).map(async ({market,symbol})=>{
    try{return await scanOne(market,symbol,eventData)}
    catch{return {status:'DATA_UNAVAILABLE',market,symbol}}}));
   rows.push(...out);
  }
  let published=0,skipped=0,errors=0;
  const qualified=rows.filter(x=>x.status==='QUALIFIED');
  for(const item of qualified){
   if(!publish){skipped++;continue}
   try{
    const result=await publisher(item);
    if(result?.published){published++;item.status='PUBLISHED'}
    else{skipped++;item.status='SUPPRESSED'}
   }catch{errors++;item.status='PUBLISH_ERROR'}
  }
  return {status:errors?'PARTIAL_FAILURE':'COMPLETED',scanned:rows.length,
   qualified:qualified.length,published,skipped,errors,
   counts:Object.fromEntries([...new Set(rows.map(x=>x.status))].map(s=>[s,rows.filter(x=>x.status===s).length])),
   results:rows.map(x=>({market:x.market,symbol:x.symbol,status:x.status})),
   note:'Missing or low-quality setups produce zero signals; no guaranteed hourly output.'};
 }
 return{scanOne,run};
}
module.exports={createAutoEngine,evaluate,validateBars,completed4h,CRYPTO,FX,STRATEGY};
