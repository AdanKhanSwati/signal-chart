/**
 * Public price-history endpoint for SignalChart on Cloudflare Workers Free.
 * This does not produce trade signals or imply execution-quality forex prices.
 * Rates are from third parties; failures show an explicit 502, never made-up
 * candle data. Limits and in-isolate caching protect free-tier resources.
 */
import {FOREX} from './market-catalog.mjs';
const SPECIAL={
 USDJPY:'JPY=X',USDCHF:'CHF=X',USDCAD:'CAD=X',USDSGD:'SGD=X',
 USDHKD:'HKD=X',USDNOK:'NOK=X',USDSEK:'SEK=X',USDCNH:'CNH=X',
 USDMXN:'MXN=X',USDZAR:'ZAR=X',USDTRY:'TRY=X',USDINR:'INR=X',
 USDTHB:'THB=X',USDPLN:'PLN=X',USDDKK:'DKK=X',USDILS:'ILS=X'
};
const FX=Object.fromEntries(FOREX.map(s=>[s,SPECIAL[s]||s+'=X']));
const INTERVALS=Object.freeze({
 '1m':{i:'1m',range:'7d'},
 '3m':{i:'1m',range:'7d',bucket:180},
 '5m':{i:'5m',range:'60d'},
 '15m':{i:'15m',range:'60d'},
 '30m':{i:'30m',range:'60d'},
 '1h':{i:'60m',range:'60d'},
 '4h':{i:'60m',range:'60d',bucket:14400},
 '1d':{i:'1d',range:'1y'},
 '1w':{i:'1wk',range:'5y'}
});
const CACHE=new Map();
const MAX_TEXT=2_500_000;
function response(data,status=200){
 return new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json; charset=utf-8',
  'X-Content-Type-Options':'nosniff',
  'Cache-Control':status===200?'public,max-age=10,s-maxage=10,stale-while-revalidate=25':'no-store'
 }});
}
function numeric(x){return x!==null&&x!==undefined&&Number.isFinite(Number(x))}
function cleanBars(rows){
 const out=[];
 for(const row of rows){
  if(!numeric(row.time)||!numeric(row.open)||!numeric(row.high)||
     !numeric(row.low)||!numeric(row.close))continue;
  const time=Number(row.time),open=Number(row.open),high=Number(row.high),
   low=Number(row.low),close=Number(row.close),volume=Number(row.volume)||0;
  if(!Number.isInteger(time)||time<=0||open<=0||high<=0||low<=0||close<=0||
     high<Math.max(open,close,low)||low>Math.min(open,close,high))continue;
  out.push({time,open,high,low,close,volume:Math.max(0,volume)});
 }
 out.sort((a,b)=>a.time-b.time);
 return out.filter((x,i)=>i===0||x.time!==out[i-1].time);
}
function aggregate(bars,bucket){
 const groups=new Map();
 for(const r of bars){
  const time=Math.floor(r.time/bucket)*bucket;
  const existing=groups.get(time);
  if(existing){existing.high=Math.max(existing.high,r.high);
   existing.low=Math.min(existing.low,r.low);
   existing.close=r.close;existing.volume+=r.volume;}
  else groups.set(time,{...r,time});
 }
 return [...groups.values()].sort((a,b)=>a.time-b.time);
}
async function provider(fetchFn,url){
 const res=await fetchFn(url,{
  method:'GET',headers:{Accept:'application/json'},
  cache:'no-store',signal:AbortSignal.timeout(5000)
 });
 const length=Number(res.headers.get('content-length')||0);
 if(!res.ok||(length>0&&length>MAX_TEXT))throw Error('Market provider unavailable');
 const text=await res.text();
 if(text.length>MAX_TEXT)throw Error('Market response too large');
 return JSON.parse(text);
}
function params(request){
 const q=new URL(request.url).searchParams;
 const market=String(q.get('market')||'crypto').toLowerCase(),
  symbol=String(q.get('symbol')||'BTCUSDT').toUpperCase(),
  interval=String(q.get('interval')||'15m');
 if(!Object.hasOwn(INTERVALS,interval))return {error:'Unsupported interval'};
 if(market==='crypto'&&!/^[A-Z0-9]{2,20}(USDT|USDC)$/.test(symbol))
  return {error:'Invalid crypto futures symbol'};
 if(market==='forex'&&!Object.hasOwn(FX,symbol))
  return {error:'Unsupported forex symbol'};
 if(!['crypto','forex'].includes(market))return {error:'Unsupported market'};
 return {market,symbol,interval};
}
const COINBASE_BASES=new Set('BTC ETH SOL XRP DOGE ADA AVAX LINK LTC BCH UNI'.split(' '));
const COINBASE_INTERVALS={'1m':60,'5m':300,'15m':900,'1h':3600,'1d':86400};
async function coinbaseSpot(fetchFn,symbol,interval){
 const base=symbol.replace(/(?:USDT|USDC)$/,'');
 const granularity=COINBASE_INTERVALS[interval];
 if(!COINBASE_BASES.has(base)||!granularity)return null;
 const raw=await provider(fetchFn,'https://api.exchange.coinbase.com/products/'+
  encodeURIComponent(base)+'-USD/candles?granularity='+granularity);
 if(!Array.isArray(raw)||raw.length>500)throw Error('Invalid Coinbase data');
 const bars=cleanBars(raw.map(v=>({time:v?.[0],low:v?.[1],high:v?.[2],
  open:v?.[3],close:v?.[4],volume:v?.[5]})));
 return bars.length>=5?bars:null;
}

export async function getCandles(request,{fetchFn=globalThis.fetch,now=Date.now}={}){
 if(request.method!=='GET')return response({error:'GET only'},405);
 const input=params(request);
 if(input.error)return response({error:input.error},400);
 const {market,symbol,interval}=input;
 const key=market+':'+symbol+':'+interval;
 const saved=CACHE.get(key);
 if(saved&&saved.expires>now())return response(saved.data);
 let bars=[],source='',instrument='indicative_fx',quoteCurrency=null,aliasOnly=false;
 try{
  if(market==='crypto'){
   const exchangeRows=raw=>{
    if(!Array.isArray(raw)||raw.length>500)throw Error('Invalid crypto candles');
    return cleanBars(raw.map(v=>({time:Math.floor(Number(v[0])/1000),
     open:v[1],high:v[2],low:v[3],close:v[4],volume:v[5]})));
   };
   // Try exact USD-M perpetuals first. A blocked provider must not result
   // in an empty chart when a genuine, clearly labeled spot chart is available.
   try{
    bars=exchangeRows(await provider(fetchFn,'https://fapi.binance.com/fapi/v1/klines?symbol='+
     encodeURIComponent(symbol)+'&interval='+encodeURIComponent(interval)+'&limit=240'));
    if(bars.length<5)throw Error('Empty futures candle feed');
    source='Binance USD-M perpetual futures';
    instrument='perpetual';
   }catch{
    try{
     bars=exchangeRows(await provider(fetchFn,
      'https://data-api.binance.vision/api/v3/klines?symbol='+
      encodeURIComponent(symbol)+'&interval='+encodeURIComponent(interval)+'&limit=240'));
     if(bars.length<5)throw Error('Empty spot candle feed');
     source='Binance Spot price history (NOT futures)';
     instrument='spot';
    }catch{
     // Coinbase uses USD, NOT USDT/USDC. Explicitly disclose the reference
     // currency and alias status; never imply this is exchange futures OHLC.
     bars=await coinbaseSpot(fetchFn,symbol,interval)||[];
     if(bars.length<5)throw Error('No verified chart provider available');
     source='Coinbase Exchange USD spot reference (NOT USDT/USDC futures)';
     instrument='spot_reference';
     quoteCurrency='USD';
     aliasOnly=true;
    }
   }
  }else{
   const o=INTERVALS[interval],code=encodeURIComponent(FX[symbol]);
   for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{
     const chart=await provider(fetchFn,'https://'+host+'/v8/finance/chart/'+code+
      '?range='+o.range+'&interval='+o.i);
     const result=chart?.chart?.result?.[0],
      timestamps=result?.timestamp,quote=result?.indicators?.quote?.[0];
     if(!Array.isArray(timestamps)||!quote||timestamps.length>15000)
      throw Error('Malformed forex provider response');
     bars=cleanBars(timestamps.map((t,i)=>({
      time:t,open:quote.open?.[i],high:quote.high?.[i],low:quote.low?.[i],
      close:quote.close?.[i],volume:quote.volume?.[i]||0
     })));
     if(o.bucket)bars=aggregate(bars,o.bucket);
     if(bars.length<8)throw Error('Insufficient FX history');
     source='Yahoo Finance indicative FX chart';
     break;
    }catch{bars=[]}
   }
  }
  if(bars.length<5)throw Error('Insufficient candles');
  const result={
   market,symbol,interval,source,instrument,
   quoteCurrency:quoteCurrency||(market==='crypto'?symbol.endsWith('USDC')?'USDC':'USDT':null),
   quoteBasis:market==='forex'?'Indicative OHLC; not broker-executable':
    instrument==='perpetual'?'Futures traded-market OHLC':
    instrument==='spot'?'Spot exchange OHLC — not futures':
    'USD spot reference only — not executable USDT or USDC futures',
   aliasOnly,
   candles:bars.slice(-240),asof:new Date(now()).toISOString()
  };
  if(CACHE.size>=100)CACHE.clear();
  CACHE.set(key,{data:result,expires:now()+10000});
  return response(result);
 }catch{
  return response({error:'Market candles temporarily unavailable'},502);
 }
}
