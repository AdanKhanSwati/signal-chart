'use strict';
/** Public market PRICE snapshots only; no premium signal information. */
const PAIRS='EURUSD GBPUSD USDJPY USDCHF USDCAD AUDUSD NZDUSD EURGBP EURJPY EURCHF EURAUD EURCAD EURNZD GBPJPY GBPCHF GBPAUD GBPCAD GBPNZD AUDJPY AUDCAD AUDNZD AUDCHF NZDJPY NZDCAD NZDCHF CADJPY CADCHF CHFJPY USDSGD USDHKD USDNOK USDSEK USDCNH USDMXN USDZAR USDTRY USDINR USDPKR'.split(' ');
const TOP=new Set(['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','BNBUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','LTCUSDT']);
const cache=new Map();
async function json(fetchFn,url){
 const r=await fetchFn(url,{headers:{Accept:'application/json','User-Agent':'SignalChartMarketData/1.0'},
  cache:'no-store',signal:AbortSignal.timeout(11000)});
 if(!r.ok)throw Error('Provider unavailable');
 return r.json();
}
const finite=x=>x!==undefined&&x!==null&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
function createHandler({fetchFn=globalThis.fetch,catalog=require('../lib/sc-market-catalog'),clock=()=>Date.now()}={}){
 return async function(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','public, s-maxage=15, stale-while-revalidate=30');
  if(req.method!=='GET')return res.status(405).json({error:'GET only'});
  const mode=String(req.query?.mode||''),market=String(req.query?.market||'crypto');
  if(mode==='catalog')return catalog(req,res);
  if(!['crypto','forex'].includes(market))return res.status(400).json({error:'Unsupported market'});
  const key=market+':'+String(req.query?.all)==='1';
  const old=cache.get(key);
  if(old&&clock()-old.at<15000)return res.status(200).json(old.data);
  try{
   let quotes={},source='',asof=new Date(clock()).toISOString(),indicative=false;
   if(market==='crypto'){
    const rows=await json(fetchFn,'https://fapi.binance.com/fapi/v1/ticker/24hr');
    if(!Array.isArray(rows))throw Error('Invalid exchange response');
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
