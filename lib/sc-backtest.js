'use strict';
/* Transparent and reproducible hourly technical backtest.
 * NOT a verified live-performance record. No historical news/funding conditioning.
 */
const crypto=require('node:crypto'),H=3600000;
const MARKET=/^[A-Z0-9]{2,14}USDT$/;
const FX={EURUSD:'EURUSD=X',GBPUSD:'GBPUSD=X',USDJPY:'JPY=X',AUDUSD:'AUDUSD=X',USDCAD:'CAD=X',USDCHF:'CHF=X',NZDUSD:'NZDUSD=X',EURGBP:'EURGBP=X',GBPJPY:'GBPJPY=X'};
const params={indicator:'EMA20/50+RSI14+ATR14+breakout/retest+4h agreement',maxHoldHours:16,rr:1.5,stopATR:1.45,feeBpsCryptoPerSide:4,slippageBpsCryptoPerSide:2.5,fxIndicativeRoundTripBps:8,walletRiskPercent:.5};
let cache=new Map();
const avg=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
async function get(url){const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),9500);try{const r=await fetch(url,{signal:ac.signal,cache:'no-store',headers:{Accept:'application/json','User-Agent':'SignalChartValidation/1.0'}});if(!r.ok)throw Error('Provider returned '+r.status);return r.json()}finally{clearTimeout(timer)}}
async function candles(symbol,days){
 const cryptoMarket=MARKET.test(symbol),now=Date.now();
 if(cryptoMarket){
  const rows=[];let endTime=now,calls=Math.ceil((days+12)*24/1000);
  for(let i=0;i<calls;i++){
   const v=await get('https://fapi.binance.com/fapi/v1/klines?symbol='+encodeURIComponent(symbol)+'&interval=1h&limit=1000&endTime='+endTime);
   if(!Array.isArray(v)||!v.length)break;
   rows.unshift(...v.map(x=>({time:+x[0],closeTime:+x[6],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5]})));
   endTime=+v[0][0]-1;if(endTime<=now-(days+14)*24*H)break
  }
  return{source:'Binance USD-M futures hourly klines',rows,crypto:true}
 }
 if(!FX[symbol])throw Error('Unsupported backtest symbol');
 let error;
 for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
  try{
   const v=await get('https://'+host+'/v8/finance/chart/'+encodeURIComponent(FX[symbol])+'?range=60d&interval=60m'),
    ch=v?.chart?.result?.[0],times=ch?.timestamp||[],q=ch?.indicators?.quote?.[0];
   if(!times.length||!q)throw Error('FX history unavailable');
   const rows=times.map((t,i)=>({time:+t*1000,closeTime:+t*1000+H-1,open:+q.open?.[i],high:+q.high?.[i],low:+q.low?.[i],close:+q.close?.[i],volume:0}));
   return{source:'Yahoo Finance indicative hourly FX chart (not broker quotes)',rows,crypto:false}
  }catch(e){error=e}
 }
 throw error||Error('FX history unavailable')
}
function ema(c,p){let value=c[0],k=2/(p+1);for(let i=1;i<c.length;i++)value=c[i]*k+value*(1-k);return value}
function indicators(rows,i){
 const window=rows.slice(Math.max(0,i-80),i+1),cl=window.map(x=>x.close),last=window.at(-1);
 const e20=ema(cl,20),e50=ema(cl,50),delta=cl.slice(-15).map((v,j,ar)=>j?v-ar[j-1]:0).slice(1),
  gains=avg(delta.map(x=>Math.max(0,x))),losses=avg(delta.map(x=>Math.max(0,-x))),
  rsi=losses?100-100/(1+gains/losses):gains?100:50;
 const xs=window.slice(-15),ranges=xs.slice(1).map((v,j)=>Math.max(v.high-v.low,Math.abs(v.high-xs[j].close),Math.abs(v.low-xs[j].close)));
 return{last,e20,e50,rsi,atr:avg(ranges),volumeRatio:last.volume&&window.length>21?last.volume/Math.max(.00001,avg(window.slice(-21,-1).map(x=>x.volume))):null};
}
function completed4h(rows){
 const groups=new Map();for(const b of rows){
  const start=Math.floor(b.time/(4*H))*4*H;
  if(!groups.has(start))groups.set(start,{time:start,closeTime:start+4*H-1,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,hours:0});
  const x=groups.get(start);x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.volume+=(b.volume||0);x.hours++
 }
 return [...groups.values()].filter(x=>x.hours>=4).sort((a,b)=>a.time-b.time)
}
function scoreSignal(rows,i,highBars,market){
 const a=indicators(rows,i),bar=rows[i],completed=highBars.filter(x=>x.closeTime<=bar.closeTime);
 if(completed.length<50||!a.atr||!(a.last.close>0))return null;
 const h=indicators(completed,completed.length-1),prev=rows.slice(i-12,i);
 if(prev.length<12)return null;
 const high=Math.max(...prev.map(x=>x.high)),low=Math.min(...prev.map(x=>x.low));
 const direction=a.e20>a.e50&&h.e20>h.e50&&bar.close>a.e20?'LONG':a.e20<a.e50&&h.e20<h.e50&&bar.close<a.e20?'SHORT':null;
 if(!direction)return null;
 const isLong=direction==='LONG';
 const momentum=isLong?(a.rsi>=51&&a.rsi<=72):(a.rsi>=28&&a.rsi<=49);
 const breakout=isLong?bar.close>high:bar.close<low;
 const retest=isLong?(bar.low<a.e20*1.005&&bar.close>bar.open):(bar.high>a.e20*.995&&bar.close<bar.open);
 const volPct=a.atr/bar.close*100,volatility=market?(volPct>.18&&volPct<4.5):(volPct>.015&&volPct<1.1);
 const volumeOK=a.volumeRatio===null||a.volumeRatio>=.85;
 const score=3+(momentum?1:0)+(breakout?2:retest?1.5:0)+(volatility?1:0)+(volumeOK?1:0)+.5;
 return score>=6.5&&momentum&&(breakout||retest)&&volatility&&volumeOK?{direction,atr:a.atr,score,close:bar.close,time:bar.closeTime}:null
}
function evaluate(rows,index,signal,cryptoMarket){
 // A signal is computed at candle close. Simulated fill occurs NEXT candle open.
 if(index+1>=rows.length)return null;
 const next=rows[index+1],long=signal.direction==='LONG',entry=next.open;
 if(!(entry>0))return null;
 const dist=Math.max(signal.atr*params.stopATR,entry*(cryptoMarket?.006:.001)),
  stop=entry+(long?-1:1)*dist,target=entry+(long?1:-1)*dist*params.rr;
 let exit=null,reason='time',exitIndex=Math.min(rows.length-1,index+params.maxHoldHours);
 for(let k=index+1;k<=exitIndex;k++){
  const c=rows[k],sl=long?c.low<=stop:c.high>=stop,tp=long?c.high>=target:c.low<=target;
  if(sl){exit=long?Math.min(stop,c.open):Math.max(stop,c.open);reason=tp?'ambiguous_stop_first':'stop';exitIndex=k;break}
  if(tp){exit=target;reason='target';exitIndex=k;break}
 }
 if(exit===null){exit=rows[exitIndex].close;if(exitIndex===rows.length-1)return null}
 const grossR=(long?(exit-entry):(entry-exit))/dist;
 const roundTripBps=cryptoMarket?2*(params.feeBpsCryptoPerSide+params.slippageBpsCryptoPerSide):params.fxIndicativeRoundTripBps;
 const costsR=(entry*roundTripBps/10000)/dist;
 return{entryTime:new Date(next.time).toISOString(),exitTime:new Date(rows[exitIndex].closeTime).toISOString(),direction:signal.direction,
  entry:+entry.toFixed(8),stop:+stop.toFixed(8),target:+target.toFixed(8),exit:+exit.toFixed(8),
  outcome:reason,grossR:+grossR.toFixed(4),netR:+(grossR-costsR).toFixed(4),modelCostsR:+costsR.toFixed(4),score:+signal.score.toFixed(1)}
}
function metrics(trades){
 const n=trades.length,total=trades.reduce((a,b)=>a+b.netR,0),wins=trades.filter(x=>x.netR>0).length,
  losses=n-wins,win=n?wins/n:null;
 let equity=0,peak=0,drawdown=0;
 for(const t of trades){equity+=t.netR*params.walletRiskPercent/100;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity)}
 return{trades:n,wins,losses,winRate:n?+(100*win).toFixed(2):null,totalNetR:+total.toFixed(3),avgR:n?+(total/n).toFixed(3):null,
  modelReturnPercent:+(total*params.walletRiskPercent).toFixed(2),maxDrawdownPercent:+(drawdown*100).toFixed(2),
  insufficientSample:n<30}
}
async function run(symbol,daysRequested=120){
 symbol=String(symbol||'BTCUSDT').toUpperCase();
 if(!MARKET.test(symbol)&&!FX[symbol])throw Error('Unsupported instrument');
 const isCrypto=MARKET.test(symbol),days=isCrypto?Math.max(45,Math.min(240,Math.floor(+daysRequested||120))):Math.max(30,Math.min(55,Math.floor(+daysRequested||45)));
 const key=symbol+':'+days;
 const old=cache.get(key);if(old&&Date.now()-old.at<14*60000)return old.value;
 const dataset=await candles(symbol,days),now=Date.now(),begin=now-days*24*H;
 const bars=dataset.rows.filter(x=>[x.time,x.open,x.high,x.low,x.close,x.closeTime].every(Number.isFinite)&&x.close>0&&x.closeTime<now)
  .sort((a,b)=>a.time-b.time).filter((x,i,a)=>!i||x.time!==a[i-1].time);
 if(bars.length<600)throw Error('Insufficient historical data for a valid simulation');
 const h4=completed4h(bars),trades=[];
 let previousExit=-1;
 for(let i=250;i<bars.length-params.maxHoldHours-1;i++){
  if(i<=previousExit||bars[i].time<begin)continue;
  const setup=scoreSignal(bars,i,h4,isCrypto);if(!setup)continue;
  const exit=evaluate(bars,i,setup,isCrypto);if(!exit)continue;
  trades.push(exit);previousExit=bars.findIndex(x=>x.closeTime>=Date.parse(exit.exitTime));
 }
 const split=Math.floor(trades.length*.7),inSample=trades.slice(0,split),holdout=trades.slice(split);
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(bars.map(x=>[x.time,x.open,x.high,x.low,x.close,x.volume]))).digest('hex');
 const result={
  status:'HISTORICAL_SIMULATION_ONLY',auditStatus:'NOT_EXTERNALLY_VERIFIED',symbol,market:isCrypto?'crypto':'forex',modelVersion:'sc-technical-1.0',
  parameters:params,source:dataset.source,requestedDays:days,candles:bars.length,firstCandle:new Date(bars[0].time).toISOString(),lastCandle:new Date(bars.at(-1).closeTime).toISOString(),
  datasetSHA256:fingerprint,generatedAt:new Date().toISOString(),
  all:metrics(trades),developmentSample:metrics(inSample),chronologicalHoldout:metrics(holdout),
  holdoutBoundary:holdout[0]?.entryTime||null,
  tradeExamples:trades.slice(-20),
  caveats:[
   'Diagnostic simulation, not verified real trading performance or evidence of future profits.',
   'Historical event-calendar blackout periods and historical futures funding costs are NOT reconstructed.',
   'FX data are indicative and not broker-executable; the spread cost is a modeling assumption.',
   'Next-candle-open entry and conservative stop-first handling of ambiguous OHLC bars are applied.',
   'No parameter fitting occurs; holdout is a chronological reporting split, not a complete independent audit.',
   'Results exclude liquidation, borrowing costs, overnight FX rollovers and exchange-specific margin requirements.'
  ]
 };
 cache.set(key,{at:Date.now(),value:result});return result;
}
module.exports={run};
