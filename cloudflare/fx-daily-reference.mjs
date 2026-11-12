/** Published daily forex reference history. NOT intraday candles or an
 * executable market quote. Used only when real FX OHLC providers fail. */
import {FOREX} from './market-catalog.mjs';
const ALLOWED=new Set(FOREX),CACHE=new Map(),MAX_BYTES=180000;
function reply(data,status=200){
 return new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json; charset=utf-8',
  'X-Content-Type-Options':'nosniff',
  'Cache-Control':status===200?'public,max-age=600,s-maxage=600':'no-store'
 }});
}
function parseRows(raw,base,quote,now){
 if(!Array.isArray(raw)||raw.length>150)throw Error('Invalid reference series');
 const seen=new Set(),points=[];
 const today=new Date(now()).toISOString().slice(0,10);
 for(const row of raw){
  const date=String(row?.date||''),rate=Number(row?.rate);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||
     date>today||String(row?.base||'').toUpperCase()!==base||
     String(row?.quote||'').toUpperCase()!==quote||
     !Number.isFinite(rate)||rate<=0||seen.has(date))
   throw Error('Invalid published reference');
  const ms=Date.parse(date+'T00:00:00Z');
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==date)
   throw Error('Invalid reference date');
  seen.add(date);points.push({time:Math.floor(ms/1000),rate});
 }
 points.sort((a,b)=>a.time-b.time);
 if(points.length<12)throw Error('Insufficient published reference history');
 return points;
}
export async function getFxDailyReferences(request,{fetchFn=globalThis.fetch,now=Date.now}={}){
 if(request.method!=='GET')return reply({error:'GET only'},405);
 const q=new URL(request.url).searchParams,symbol=String(q.get('symbol')||'').toUpperCase();
 if(!ALLOWED.has(symbol))return reply({error:'Unsupported forex pair'},400);
 const existing=CACHE.get(symbol);
 if(existing&&existing.expiry>now())return reply(existing.data);
 const base=symbol.slice(0,3),quote=symbol.slice(3),from=new Date(now()-95*86400000).toISOString().slice(0,10);
 const url='https://api.frankfurter.dev/v2/rates?base='+encodeURIComponent(base)+
  '&quotes='+encodeURIComponent(quote)+'&from='+from;
 try{
  const res=await fetchFn(url,{method:'GET',headers:{Accept:'application/json'},
   cache:'no-store',signal:AbortSignal.timeout(6000)});
  const len=Number(res.headers.get('content-length')||0);
  if(!res.ok||len>MAX_BYTES)throw Error('Reference provider unavailable');
  const text=await res.text();
  if(text.length>MAX_BYTES)throw Error('Reference series exceeds limit');
  const points=parseRows(JSON.parse(text),base,quote,now);
  const last=points.at(-1);
  const result={market:'forex',symbol,granularity:'1d',
   instrument:'daily_reference',historicalOnly:true,referenceOnly:true,
   source:'Frankfurter blended published daily currency references',
   note:'Daily published rates only, NOT live prices, intraday OHLC or tradable broker quotes',
   stale:now()-last.time*1000>10*86400000,points};
  if(CACHE.size>90)CACHE.clear();
  CACHE.set(symbol,{data:result,expiry:now()+3600000});
  return reply(result);
 }catch{return reply({error:'Daily forex references temporarily unavailable'},502)}
}
