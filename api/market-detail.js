'use strict';
/** Public historical OHLC and statistical indicators, never premium trading setups. */
function rsi(values,n=14){
 if(values.length<n+1)return null;let gains=0,losses=0;
 for(let i=values.length-n;i<values.length;i++){const delta=values[i]-values[i-1];gains+=Math.max(0,delta);losses+=Math.max(0,-delta)}
 if(losses===0)return gains===0?50:100;
 return +(100-100/(1+gains/losses)).toFixed(2);
}
const sma=(values,n)=>values.length<n?null:+(values.slice(-n).reduce((a,b)=>a+b,0)/n).toFixed(6);
const COINBASE_BASES=new Set(['BTC','ETH','SOL','XRP','DOGE','ADA','AVAX','LINK','LTC','BNB','TRX','UNI']);
const COINBASE_GRANULARITIES={'1m':60,'5m':300,'15m':900,'1h':3600,'1d':86400};
async function spotFallback({symbol,interval},fetchFn){
 const base=/^([A-Z0-9]{2,12})USDT$/.exec(symbol)?.[1];
 const granularity=COINBASE_GRANULARITIES[interval];
 if(!COINBASE_BASES.has(base)||!granularity)return null;
 const url='https://api.exchange.coinbase.com/products/'+base+'-USD/candles?granularity='+granularity;
 const response=await fetchFn(url,{cache:'no-store',signal:AbortSignal.timeout(10000),
  headers:{Accept:'application/json','User-Agent':'SignalChartMarketResearch/1.0'}});
 if(!response.ok)throw Error('Coinbase spot feed unavailable');
 const data=await response.json();
 if(!Array.isArray(data))throw Error('Invalid Coinbase spot history');
 const rows=data.map(v=>({time:Number(v[0]),low:Number(v[1]),high:Number(v[2]),
  open:Number(v[3]),close:Number(v[4]),volume:Number(v[5])}))
  .filter(v=>[v.time,v.low,v.high,v.open,v.close,v.volume].every(Number.isFinite)&&v.close>0)
  .sort((a,b)=>a.time-b.time);
 if(rows.length<8)throw Error('Insufficient authenticated spot history');
 return {market:'crypto',symbol,interval,
  source:'Coinbase Exchange USD spot (NOT USDT futures)',
  quoteBasis:'USD spot OHLC reference, not executable USDT futures prices',
  candles:rows.slice(-240),asof:new Date().toISOString(),indicative:true,
  quoteCurrency:'USD',aliasOnly:true};
}
function createHandler({candles=require('../lib/sc-candles-core'),fetchFn=globalThis.fetch}={}){
 return async function(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','public, s-maxage=20');
  if(req.method!=='GET')return res.status(405).json({error:'GET only'});
  const symbol=String(req.query?.symbol||'BTCUSDT').toUpperCase();
  const market=String(req.query?.market||(/USDT$/.test(symbol)?'crypto':'forex'));
  const interval=String(req.query?.interval||'1d');
  let status=200,body={};
  const fake={
   setHeader(){return this},
   status(code){status=code;return this},
   json(data){body=data;return this}
  };
  await candles({method:'GET',query:{market,symbol,interval}},fake);
  if(status===502&&market==='crypto'){
   try{const spot=await spotFallback({symbol,interval},fetchFn);
    if(spot){body=spot;status=200}
   }catch{
    // Never make up a candle when both independently sourced providers fail.
   }
  }
  if(status!==200)return res.status(status).json({error:body.error||'Market candles unavailable'});
  const rows=Array.isArray(body.candles)?body.candles:[];
  const closes=rows.map(x=>Number(x.close)).filter(Number.isFinite);
  if(closes.length<2)return res.status(503).json({error:'Verified market history unavailable'});
  const last=rows.at(-1),prev=closes.at(-2),changePercent=prev>0?(last.close-prev)/prev*100:null;
  const allowedStats={changePercent:changePercent===null?null:+changePercent.toFixed(3),
   high:Number.isFinite(last.high)?last.high:null,low:Number.isFinite(last.low)?last.low:null,
   volume:Number.isFinite(last.volume)?last.volume:null,rsi14:rsi(closes),
   sma20:sma(closes,20),sma50:sma(closes,50)};
  return res.status(200).json({market,symbol,interval,source:body.source,
   quoteBasis:body.quoteBasis,asof:body.asof,
   indicative:body.indicative===true,quoteCurrency:body.quoteCurrency||'USDT',
   aliasOnly:body.aliasOnly===true,
   stats:allowedStats,candles:rows.slice(-240).map(x=>({
    time:x.time,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume
   })),
   note:'Historical prices and statistical indicators only. No premium direction, entry, stop-loss or target data.'});
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
