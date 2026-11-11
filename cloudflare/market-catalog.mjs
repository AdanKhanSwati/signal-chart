/**
 * Public, non-actionable market catalog for Cloudflare Workers Free.
 * The upstream Binance futures listing is refreshed at most once per isolated
 * Worker instance every ten minutes; a bounded fallback is always available.
 * Individual crypto and forex symbols here are only market metadata.
 */
const FOREX='EURUSD GBPUSD USDJPY USDCHF USDCAD AUDUSD NZDUSD EURGBP EURJPY EURCHF EURAUD EURCAD EURNZD GBPJPY GBPCHF GBPAUD GBPCAD GBPNZD AUDJPY AUDNZD AUDCAD AUDCHF NZDJPY NZDCAD NZDCHF CADJPY CADCHF CHFJPY USDSEK USDNOK USDDKK USDSGD USDHKD USDZAR USDMXN USDTRY USDPLN USDCNH EURSEK EURNOK EURDKK EURPLN EURZAR GBPSEK GBPNOK GBPZAR AUDSGD SGDJPY USDINR USDTHB USDILS'.split(' ');
const FALLBACK='BTC ETH SOL XRP DOGE ADA AVAX LINK DOT LTC BCH BNB TRX ATOM UNI AAVE NEAR OP ARB SUI INJ FIL HBAR ICP ALGO APT'.split(' ');
let cached=null,expires=0;
function forexMarkets(){
 return FOREX.map(symbol=>({symbol,name:symbol.slice(0,3)+'/'+symbol.slice(3),
  base:symbol.slice(0,3),quote:symbol.slice(3),type:'forex'}));
}
function fallbackMarkets(){
 return FALLBACK.map(base=>({symbol:base+'USDT',name:base+'/USDT',base,quote:'USDT',type:'crypto'}));
}
function normalize(raw){
 if(!Array.isArray(raw?.symbols)||raw.symbols.length>10000)return null;
 const seen=new Set(),out=[];
 for(const x of raw.symbols){
  if(x?.status!=='TRADING'||x?.contractType!=='PERPETUAL'||
     !['USDT','USDC'].includes(x.quoteAsset)||typeof x.baseAsset!=='string'||
     typeof x.symbol!=='string')continue;
  const symbol=x.symbol.toUpperCase(),base=x.baseAsset.toUpperCase();
  if(!/^[A-Z0-9]{3,24}$/.test(symbol)||!/^[A-Z0-9]{1,16}$/.test(base)||
     seen.has(symbol))continue;
  seen.add(symbol);
  out.push({symbol,name:base+'/'+x.quoteAsset,base,quote:x.quoteAsset,type:'crypto'});
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
export async function listMarkets({fetchFn=globalThis.fetch,now=Date.now}={}){
 if(cached&&now()<expires)return response(cached);
 let crypto,source='Binance USD-M futures exchangeInfo';
 try{
  const r=await fetchFn('https://fapi.binance.com/fapi/v1/exchangeInfo',{
   method:'GET',headers:{Accept:'application/json'},
   signal:AbortSignal.timeout(6000),cache:'no-store'
  });
  const size=Number(r.headers.get('content-length')||0);
  if(!r.ok||(size>0&&size>1500000))throw Error('Invalid upstream data');
  const text=await r.text();
  if(text.length>1500000)throw Error('Upstream market catalog is too large');
  crypto=normalize(JSON.parse(text));
  if(!crypto)throw Error('Empty market listing');
 }catch{
  crypto=fallbackMarkets();source='Fallback market symbols — exchange catalog unavailable';
 }
 const fx=forexMarkets();
 cached={markets:[...crypto,...fx],count:{crypto:crypto.length,forex:fx.length},
  source,note:'Charts show provider candles; FX indicative and not broker-executable'};
 expires=now()+600000;
 return response(cached);
}
