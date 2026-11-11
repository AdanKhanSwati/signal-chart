/**
 * Public, non-actionable market catalog for Cloudflare Workers Free.
 * The upstream Binance futures listing is refreshed at most once per isolated
 * Worker instance every ten minutes; a bounded fallback is always available.
 * Individual crypto and forex symbols here are only market metadata.
 */
export const FOREX='EURUSD GBPUSD USDJPY USDCHF USDCAD AUDUSD NZDUSD EURGBP EURJPY EURCHF EURAUD EURCAD EURNZD GBPJPY GBPCHF GBPAUD GBPCAD GBPNZD AUDJPY AUDNZD AUDCAD AUDCHF NZDJPY NZDCAD NZDCHF CADJPY CADCHF CHFJPY USDSEK USDNOK USDDKK USDSGD USDHKD USDZAR USDMXN USDTRY USDPLN USDCNH EURSEK EURNOK EURDKK EURPLN EURZAR GBPSEK GBPNOK GBPZAR AUDSGD SGDJPY USDINR USDTHB USDILS'.split(' ');
const FALLBACK='BTC ETH SOL XRP DOGE ADA AVAX LINK DOT LTC BCH BNB TRX ATOM UNI AAVE NEAR OP ARB SUI INJ FIL HBAR ICP ALGO APT'.split(' ');
let cached=null,expires=0;
function forexMarkets(){
 return FOREX.map(symbol=>({symbol,name:symbol.slice(0,3)+'/'+symbol.slice(3),
  base:symbol.slice(0,3),quote:symbol.slice(3),type:'forex',instrument:'indicative_fx'}));
}
function fallbackMarkets(){
 return FALLBACK.map(base=>({symbol:base+'USDT',name:base+'/USDT',base,quote:'USDT',type:'crypto',instrument:'unverified'}));
}
function normalize(raw,spot=false){
 if(!Array.isArray(raw?.symbols)||raw.symbols.length>10000)return null;
 const seen=new Set(),out=[];
 for(const x of raw.symbols){
  if(x?.status!=='TRADING'||(!spot&&x?.contractType!=='PERPETUAL')||
     !['USDT','USDC'].includes(x.quoteAsset)||typeof x.baseAsset!=='string'||
     typeof x.symbol!=='string')continue;
  const symbol=x.symbol.toUpperCase(),base=x.baseAsset.toUpperCase();
  if(!/^[A-Z0-9]{3,24}$/.test(symbol)||!/^[A-Z0-9]{1,16}$/.test(base)||
     seen.has(symbol))continue;
  seen.add(symbol);
  out.push({symbol,name:base+'/'+x.quoteAsset,base,quote:x.quoteAsset,type:'crypto',instrument:spot?'spot':'perpetual'});
 }
 return out.length?out:null;
}
function response(data){
 return new Response(JSON.stringify(data),{headers:{
  'Content-Type':'application/json; charset=utf-8',
  'X-Content-Type-Options':'nosniff',
  'Cache-Control':'public, max-age=120, s-maxage=600, stale-while-revalidate=300'
 }});
}
async function providerListing(fetchFn,url,maxBytes,spot){
 const r=await fetchFn(url,{
  method:'GET',headers:{Accept:'application/json'},
  signal:AbortSignal.timeout(6500),cache:'no-store'
 });
 const size=Number(r.headers.get('content-length')||0);
 if(!r.ok||(size>0&&size>maxBytes))throw Error('Upstream exchange catalog unavailable');
 const text=await r.text();
 if(text.length>maxBytes)throw Error('Upstream exchange listing too large');
 const symbols=normalize(JSON.parse(text),spot);
 if(!symbols)throw Error('Empty exchange listing');
 return symbols;
}
export async function listMarkets({fetchFn=globalThis.fetch,now=Date.now}={}){
 if(cached&&now()<expires)return response(cached);
 let crypto,source='Binance USD-M perpetual futures',instrument='perpetual';
 try{
  crypto=await providerListing(fetchFn,'https://fapi.binance.com/fapi/v1/exchangeInfo',2000000,false);
 }catch{
  // Public Binance Spot market-data-only endpoint is a different instrument
  // from futures. Explicitly identify it rather than mislabel spot as futures.
  try{
   crypto=await providerListing(fetchFn,'https://data-api.binance.vision/api/v3/exchangeInfo',8000000,true);
   source='Binance Spot (USD-M futures catalog unavailable)';
   instrument='spot';
  }catch{
   crypto=fallbackMarkets();
   source='Fallback market symbols — exchange catalogs unavailable';
   instrument='unverified';
  }
 }
 const fx=forexMarkets();
 cached={markets:[...crypto,...fx],count:{crypto:crypto.length,forex:fx.length},
  source,instrument,
  note:'Market directory is indicative; spot data is not futures and FX is not broker-executable.'};
 expires=now()+600000;
 return response(cached);
}
