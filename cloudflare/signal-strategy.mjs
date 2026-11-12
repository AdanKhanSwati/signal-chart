/**
 * Cloudflare-safe deterministic signal STRATEGY ONLY.
 * Read-only scanner; never sends signals to customers or stores forecasts.
 * Synchronized with lib/sc-auto-engine.js and parity tested in CI.
 * No upstream price or calendar is trusted until validated by the caller.
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
function validateBars(rows,now,market='crypto'){
 if(!Array.isArray(rows))throw Error('Candle data unavailable');
 const bars=rows.filter(validBar).filter(b=>b.closeTime<=now-60000)
  .sort((a,b)=>a.time-b.time).filter((b,i,a)=>i===0||b.time!==a[i-1].time);
 if(bars.length<260)throw Error('Not enough verified completed candles');
 const last=bars.at(-1);
 if(now-last.closeTime>30*60000||last.closeTime>now-60000)
  throw Error('Stale or unclosed market candle');
 const continuity=market==='forex'?bars.slice(-12):bars.slice(-55);
 if(continuity.some((b,i,a)=>i>0&&b.time-a[i-1].time!==HOUR))
  throw Error('Discontinuous recent hourly candles');
 return bars;
}
function evaluate(symbol,market,rows,now){
 const bars=validateBars(rows,now,market),b=bars.at(-1),higher=completed4h(bars);
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

export {evaluate,validateBars,completed4h,CRYPTO,FX,STRATEGY};
