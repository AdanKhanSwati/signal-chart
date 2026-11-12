/**
 * Independent public USDT perpetual candle sources for SignalChart.
 * A Bybit linear contract and an OKX USDT-SWAP are actual perpetual
 * instruments, NOT Binance futures prices or interchangeable execution
 * venues. Consumers must show the source exchange explicitly.
 *
 * No private keys, wallet operations, signals, funding, or order placement.
 * All request destinations are fixed and all price levels are unmodified.
 */
const HOUR=3600000,MAX_BYTES=900000;
const BAR_MS=Object.freeze({
 '1m':60000,'3m':180000,'5m':300000,'15m':900000,
 '30m':1800000,'1h':HOUR,'4h':4*HOUR,
 '1d':86400000,'1w':604800000
});
const BYBIT=Object.freeze({
 '1m':'1','3m':'3','5m':'5','15m':'15',
 '30m':'30','1h':'60','4h':'240','1d':'D','1w':'W'
});
const OKX=Object.freeze({
 '1m':'1m','3m':'3m','5m':'5m','15m':'15m',
 '30m':'30m','1h':'1H','4h':'4H','1d':'1D','1w':'1W'
});
const finite=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v));
function acceptRows(rows,ms,max){
 if(!Array.isArray(rows)||rows.length>max||rows.length<5)throw Error('Incomplete perpetual OHLC');
 const bars=[];
 for(const r of rows){
  if(!r||![r.time,r.open,r.high,r.low,r.close,r.volume].every(finite))
   throw Error('Invalid OHLC value');
  const time=Number(r.time),open=Number(r.open),high=Number(r.high),
   low=Number(r.low),close=Number(r.close),volume=Number(r.volume);
  if(!Number.isInteger(time)||time<1600000000000||time%ms!==0||
     open<=0||high<=0||low<=0||close<=0||volume<0||
     high<Math.max(open,close,low)||low>Math.min(open,close,high))
   throw Error('Malformed perpetual candle');
  bars.push({time,closeTime:time+ms-1,open,high,low,close,volume});
 }
 bars.sort((a,b)=>a.time-b.time);
 if(bars.some((x,i)=>i>0&&x.time===bars[i-1].time))
  throw Error('Duplicate candle timestamps');
 return bars;
}
async function requestJson(fetchFn,url){
 const response=await fetchFn(url,{method:'GET',
  headers:{Accept:'application/json'},cache:'no-store',
  signal:AbortSignal.timeout(4200)});
 const len=Number(response.headers.get('content-length')||0);
 if(!response.ok||(len>0&&len>MAX_BYTES))throw Error('Perpetual exchange unavailable');
 const text=await response.text();
 if(text.length>MAX_BYTES)throw Error('Perpetual response too large');
 return JSON.parse(text);
}
export async function getAlternativePerpetual(symbol,interval,{
 fetchFn=globalThis.fetch,limit=300,minBars=5,
 venues=['bybit','okx']
}={}){
 if(typeof symbol!=='string'||!/^[A-Z0-9]{2,20}USDT$/.test(symbol)||
    !Object.hasOwn(BAR_MS,interval)||!Number.isInteger(limit)||
    limit<5||limit>350||!Number.isInteger(minBars)||
    minBars<5||minBars>limit)
  throw Error('Invalid USDT perpetual request');
 const ms=BAR_MS[interval];
 const safeVenues=Array.isArray(venues)?venues.filter(x=>x==='bybit'||x==='okx'):[];
 if(!safeVenues.length)throw Error('No allowed exchange');
 for(const venue of safeVenues){
  try{
   if(venue==='bybit'){
    const doc=await requestJson(fetchFn,
     'https://api.bybit.com/v5/market/kline?category=linear&symbol='+
      encodeURIComponent(symbol)+'&interval='+BYBIT[interval]+'&limit='+limit);
    if(doc?.retCode!==0||doc?.result?.category!=='linear'||
       doc.result.symbol!==symbol)throw Error('Wrong Bybit instrument');
    const rows=acceptRows((doc.result.list||[]).map(x=>({
     time:x?.[0],open:x?.[1],high:x?.[2],low:x?.[3],close:x?.[4],volume:x?.[5]
    })),ms,350);
    if(rows.length<minBars)throw Error('Bybit history insufficient');
    return {bars:rows,source:'Bybit USDT linear perpetual',exchange:'bybit',
     instrument:'perpetual',quoteCurrency:'USDT',symbol};
   }
   if(venue==='okx'){
    const instId=symbol.slice(0,-4)+'-USDT-SWAP';
    const doc=await requestJson(fetchFn,
     'https://www.okx.com/api/v5/market/candles?instId='+
      encodeURIComponent(instId)+'&bar='+OKX[interval]+'&limit='+Math.min(limit,300));
    if(doc?.code!=='0'||!Array.isArray(doc.data))
     throw Error('Wrong OKX instrument');
    const rows=acceptRows(doc.data.map(x=>({
     time:x?.[0],open:x?.[1],high:x?.[2],low:x?.[3],close:x?.[4],
     // OKX vol is contract quantity, not necessarily units of base coin.
     volume:x?.[5]
    })),ms,300);
    if(rows.length<minBars)throw Error('OKX history insufficient');
    return {bars:rows,source:'OKX USDT-margined swap perpetual',exchange:'okx',
     instrument:'perpetual',quoteCurrency:'USDT',symbol,
     volumeUnits:'contracts'};
   }
  }catch{/* Next independent venue, never synthesize history. */}
 }
 throw Error('No independently verified USDT perpetual history available');
}
export async function getPerpetualTicker(source,symbol,{fetchFn=globalThis.fetch}={}){
 if(!source||!['bybit','okx'].includes(source.exchange)||
    !/^[A-Z0-9]{2,20}USDT$/.test(String(symbol||'')))
  throw Error('Invalid perpetual ticker request');
 let doc,price;
 if(source.exchange==='bybit'){
  doc=await requestJson(fetchFn,
   'https://api.bybit.com/v5/market/tickers?category=linear&symbol='+encodeURIComponent(symbol));
  const r=doc?.result;
  if(doc?.retCode!==0||r?.category!=='linear'||r.list?.[0]?.symbol!==symbol)
   throw Error('Bybit ticker instrument mismatch');
  price=Number(r.list[0].lastPrice);
 }else{
  const instId=symbol.slice(0,-4)+'-USDT-SWAP';
  doc=await requestJson(fetchFn,
   'https://www.okx.com/api/v5/market/ticker?instId='+encodeURIComponent(instId));
  const row=doc?.data?.[0];
  if(doc?.code!=='0'||row?.instId!==instId)
   throw Error('OKX ticker instrument mismatch');
  price=Number(row.last);
 }
 if(!Number.isFinite(price)||price<=0)throw Error('Invalid current ticker');
 return price;
}
