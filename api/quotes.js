'use strict';
/** Public market PRICE snapshots only; no premium signal information. */
const PAIRS='EURUSD GBPUSD USDJPY USDCHF USDCAD AUDUSD NZDUSD EURGBP EURJPY EURCHF EURAUD EURCAD EURNZD GBPJPY GBPCHF GBPAUD GBPCAD GBPNZD AUDJPY AUDCAD AUDNZD AUDCHF NZDJPY NZDCAD NZDCHF CADJPY CADCHF CHFJPY USDSGD USDHKD USDNOK USDSEK USDCNH USDMXN USDZAR USDTRY USDINR USDPKR'.split(' ');
const TOP=new Set(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','BNBUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','LTCUSDT']);
const KRAKEN=['BTC','ETH','SOL','XRP','DOGE','BNB','ADA','AVAX','LINK','LTC','TRX','UNI'];
const KRAKEN_RESULT={XXBTZUSD:'BTC',XETHZUSD:'ETH',XXRPZUSD:'XRP',XDGUSD:'DOGE',XLTCZUSD:'LTC'};
/** Verified USD spot quotes, never silently treated as USDT futures. */
async function krakenFallback(fetchFn,all,asof){
 const raw=await json(fetchFn,'https://api.kraken.com/0/public/Ticker?pair='+KRAKEN.map(x=>x==='BTC'?'XBTUSD':x+'USD').join(','));
 if(!raw||!Array.isArray(raw.error)||raw.error.length||!raw.result||typeof raw.result!=='object')
  throw Error('Kraken quote provider unavailable');
 const quotes={};
 for(const [key,row] of Object.entries(raw.result)){
  const base=KRAKEN_RESULT[key]||key.replace(/USD$/,'');
  const alias=base+'USDT';
  if(!KRAKEN.includes(base)||!all&&!TOP.has(alias))continue;
  const price=finite(row?.c?.[0]);
  if(price===null||price<=0)continue;
  quotes[alias]={price,bid:finite(row.b?.[0]),ask:finite(row.a?.[0]),
   changePercent:null,high:finite(row.h?.[1]),low:finite(row.l?.[1]),
   volume:finite(row.v?.[1]),volumeBasis:'base asset units',
   asof,received_at:asof,source:'Kraken USD spot reference (NOT USDT futures)',
   quoteCurrency:'USD',aliasOnly:true,indicative:true,stale:false};
 }
 if(!Object.keys(quotes).length)throw Error('Kraken returned no supported market snapshots');
 return quotes;
}

async function json(fetchFn,url){
 const r=await fetchFn(url,{headers:{Accept:'application/json','User-Agent':'SignalChartMarketData/1.0'},
  cache:'no-store',signal:AbortSignal.timeout(11000)});
 if(!r.ok)throw Error('Provider unavailable');
 return r.json();
}
const finite=x=>x!==undefined&&x!==null&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
function createHandler({fetchFn=globalThis.fetch,catalog=require('../lib/sc-market-catalog'),clock=()=>Date.now(),cache=new Map()}={}){
 return async function(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','public, s-maxage=15, stale-while-revalidate=30');
  if(req.method!=='GET')return res.status(405).json({error:'GET only'});
  const mode=String(req.query?.mode||''),market=String(req.query?.market||'crypto');
  if(mode==='catalog')return catalog(req,res);
  if(!['crypto','forex'].includes(market))return res.status(400).json({error:'Unsupported market'});
  const key=market+':'+(String(req.query?.all||'')==='1'?'all':'top');
  const old=cache.get(key);
  if(old&&clock()-old.at<15000)return res.status(200).json(old.data);
  try{
   let quotes={},source='',asof=new Date(clock()).toISOString(),indicative=false;
   if(market==='crypto'){
    let rows;
    try{
     rows=await json(fetchFn,'https://fapi.binance.com/fapi/v1/ticker/24hr');
     if(!Array.isArray(rows)||!rows.length)throw Error('No exchange futures');
    }catch{
     // Coinbase/Kraken USD spot is a fallback source, NOT a substitute futures order price.
     quotes=await krakenFallback(fetchFn,String(req.query?.all||'')==='1',asof);
     indicative=true;source='Kraken USD spot (NOT USDT futures)';
    }
    if(rows){
    for(const row of rows){
     const s=String(row.symbol||'');
     if(!/^[A-Z0-9]{2,20}USDT$/.test(s))continue;
     if(String(req.query?.all)!=='1'&&!TOP.has(s))continue;
     const price=finite(row.lastPrice);
     if(price===null||price<=0)continue;
     quotes[s]={price,bid:finite(row.bidPrice),ask:finite(row.askPrice),
      changePercent:finite(row.priceChangePercent),high:finite(row.highPrice),
      low:finite(row.lowPrice),volume:finite(row.quoteVolume),
      asof,received_at:asof,source:'Binance USD-M Futures',indicative:false,stale:false};
    }
    source='Binance USD-M Futures';
    }
   }else{
    const result=await json(fetchFn,'https://open.er-api.com/v6/latest/USD');
    if(result?.result!=='success'||result.base_code!=='USD'||!result.rates||typeof result.rates!=='object')
      throw Error('Indicative rate provider unavailable');
    const timestamp=Date.parse(result.time_last_update_utc||'');
    if(!Number.isFinite(timestamp))throw Error('Quote timestamp unavailable');
    asof=new Date(timestamp).toISOString();
    indicative=true;source='Open ER API indicative reference FX rates';
    const rates={USD:1,...result.rates};
    for(const symbol of PAIRS){
     const base=symbol.slice(0,3),quote=symbol.slice(3,6);
     const a=finite(rates[base]),b=finite(rates[quote]);
     if(a===null||b===null||a<=0||b<=0)continue;
     quotes[symbol]={price:b/a,bid:null,ask:null,changePercent:null,high:null,low:null,volume:null,
      asof,received_at:new Date(clock()).toISOString(),source,indicative:true,
      stale:clock()-timestamp>48*3600000};
    }
   }
   if(!Object.keys(quotes).length)throw Error('No verified quotes');
   const data={market,quotes,source,asof,indicative,stale:Object.values(quotes).some(q=>q.stale),
    count:Object.keys(quotes).length,notice:market==='forex'
      ?'Indicative reference rates are not live broker quotes or executable bid/ask prices.'
      :indicative?'Kraken USD spot reference quotes are labeled with USDT-compatible UI aliases ONLY; prices are USD spot, NOT USDT or futures executable quotes.'
       :'Exchange snapshots are not guaranteed executable order fills.'};
   cache.set(key,{at:clock(),data});
   return res.status(200).json(data);
  }catch(e){
   if(old){
    const stale={...old.data,stale:true,notice:'Upstream unavailable; displaying an older exchange/provider snapshot.',
     quotes:Object.fromEntries(Object.entries(old.data.quotes).map(([k,v])=>[k,{...v,stale:true}]))};
    return res.status(200).json(stale);
   }
   return res.status(503).json({error:'Market quote provider unavailable; no prices are being estimated.'});
  }
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
