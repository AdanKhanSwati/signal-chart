'use strict';
const PAIRS={EURUSD:'EURUSD=X',GBPUSD:'GBPUSD=X',USDJPY:'JPY=X'};
const round=(n,d)=>Number(n.toFixed(d));
function ema(bars,n){let avg=0;const k=2/(n+1);return bars.map((b,i)=>avg=i?b.close*k+avg*(1-k):b.close)}
function rsi(bars,n=14){if(bars.length<n+2)return null;let gain=0,loss=0;for(let i=1;i<=n;i++){const d=bars[i].close-bars[i-1].close;gain+=Math.max(d,0);loss+=Math.max(-d,0)}gain/=n;loss/=n;for(let i=n+1;i<bars.length;i++){const d=bars[i].close-bars[i-1].close;gain=(gain*(n-1)+Math.max(d,0))/n;loss=(loss*(n-1)+Math.max(-d,0))/n}return loss===0?100:100-100/(1+gain/loss)}
function atr(bars,n=14){if(bars.length<=n)return null;let sum=0;for(let i=bars.length-n;i<bars.length;i++){const a=bars[i-1].close,b=bars[i];sum+=Math.max(b.high-b.low,Math.abs(b.high-a),Math.abs(b.low-a))}return sum/n}
function analyze(symbol,bars,at=Date.now()){
 if(!PAIRS[symbol]||!Array.isArray(bars)||bars.length<60)return {symbol,status:'UNAVAILABLE',reason:'Not enough closed-candle history'};
 const closed=bars.filter(x=>[x.time,x.open,x.high,x.low,x.close].every(Number.isFinite)&&x.close>0&&x.time*1000+900000<=at).sort((a,b)=>a.time-b.time);
 if(closed.length<60)return {symbol,status:'UNAVAILABLE',reason:'Insufficient closed-candle history'};
 const c=closed.at(-1),prior=closed.slice(-11,-1),e20=ema(closed,20).at(-1),e50=ema(closed,50).at(-1),strength=rsi(closed),volatility=atr(closed);
 if(!Number.isFinite(strength)||!(volatility>0))return {symbol,status:'UNAVAILABLE',reason:'Indicators not ready'};
 const fresh=at-(c.time+900)*1000<35*60000&&at>=(c.time+900)*1000;
 const hi=Math.max(...prior.map(x=>x.high)),lo=Math.min(...prior.map(x=>x.low));
 let direction=null,reason='No confirmed 10-candle breakout with EMA and RSI alignment';
 if(!fresh)reason='FX market closed or last completed candle is delayed';
 else if(e20>e50&&c.close>hi&&strength>=52&&strength<=75){direction='LONG';reason='Closed-candle breakout above the previous 10 bars, EMA 20 above 50, RSI 52–75'}
 else if(e20<e50&&c.close<lo&&strength>=25&&strength<=48){direction='SHORT';reason='Closed-candle breakdown below the previous 10 bars, EMA 20 below 50, RSI 25–48'}
 const d=symbol==='USDJPY'?3:5;
 return {symbol,pair:symbol.slice(0,3)+'/'+symbol.slice(3),timeframe:'15m',status:direction?'QUALIFIED':'WATCHING',direction,
 entry:direction?round(c.close,d):null,
 stop:direction?round(c.close+(direction==='LONG'?-1.5:1.5)*volatility,d):null,
 target:direction?round(c.close+(direction==='LONG'?3:-3)*volatility,d):null,
 lastPrice:round(c.close,d),ema20:round(e20,d),ema50:round(e50,d),rsi14:round(strength,1),atr14:round(volatility,d),
 breakoutHigh:round(hi,d),breakoutLow:round(lo,d),candleTime:new Date(c.time*1000).toISOString(),
 fresh,source:'Yahoo Finance indicative FX chart candles',reason,
 notice:'Experimental paper-research signal; not a broker-executable quote. No audited strategy results.'};
}
async function fetchBars(symbol,at=Date.now()){
 const ticker=PAIRS[symbol];if(!ticker)throw Error('Unsupported currency pair');
 const url=new URL('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(ticker));
 url.searchParams.set('interval','15m');url.searchParams.set('range','10d');
 const response=await fetch(url,{headers:{'User-Agent':'Candriva-Forex-Research/1.0','Accept':'application/json'},signal:AbortSignal.timeout(12000),cache:'no-store'});
 if(!response.ok)throw Error('Forex data provider HTTP '+response.status);
 const payload=await response.json(),raw=payload.chart?.result?.[0],q=raw?.indicators?.quote?.[0];
 if(!raw||!q)throw Error('Forex OHLC candles unavailable');
 return (raw.timestamp||[]).map((time,i)=>({time:Number(time),open:Number(q.open?.[i]),high:Number(q.high?.[i]),low:Number(q.low?.[i]),close:Number(q.close?.[i])}))
 .filter(x=>[x.time,x.open,x.high,x.low,x.close].every(Number.isFinite)&&x.close>0&&x.time*1000+900000<=at);
}
async function scan(symbol){const at=Date.now();return analyze(symbol,await fetchBars(symbol,at),at)}
module.exports={PAIRS,scan,analyze,fetchBars,ema,rsi,atr};
