/**
 * SignalChart Cloudflare hourly research scanner — DRY RUN ONLY.
 *
 * No paid entitlement, customer signal, trial credit or trading order is
 * touched. Only closed, source-attributed market candles are evaluated.
 * A separate, audited publication implementation is required before launch.
 */
import {createResearch} from './research.mjs';
import {evaluate,CRYPTO,FX,STRATEGY} from './signal-strategy.mjs';
import {saveDryRunAudit} from './scan-audit.mjs';
import {getAlternativePerpetual,getPerpetualTicker} from './perpetual-sources.mjs';
import {readWeeklyCalendar} from './calendar-bridge.mjs';

const HOUR=3600000,MAX_RESPONSE=2200000,MAX_AGE=20*60000;
const reply=(payload,status=200)=>new Response(JSON.stringify(payload),{
 status,headers:{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, private',
  'X-Content-Type-Options':'nosniff'
 }
});
const finite=x=>Number.isFinite(x)&&x>0;

export async function verifyScanSignature(request,env,{
 now=Date.now,cryptoImpl=globalThis.crypto
}={}){
 const secret=String(env?.SC_AUTO_CRON_SECRET||'');
 const time=request.headers.get('x-sc-timestamp')||'';
 const signature=request.headers.get('x-sc-signature')||'';
 if(secret.length<32||!/^\d{10}$/.test(time)||
    !/^[0-9a-f]{64}$/.test(signature)||
    Math.abs(now()-Number(time)*1000)>180000||
    !cryptoImpl?.subtle)return false;
 try{
  const key=await cryptoImpl.subtle.importKey(
   'raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const mac=Uint8Array.from(signature.match(/../g),byte=>parseInt(byte,16));
  return cryptoImpl.subtle.verify('HMAC',key,mac,
   new TextEncoder().encode(time+'.{}'));
 }catch{return false}
}
function calendarRisk(calendar,symbol,at){
 if(!['FULL_WEEK','SINGLE_SOURCE_WEEKLY'].includes(calendar?.coverage))return 'NEWS_UNVERIFIED';
 const relevant=symbol.endsWith('USDT')?['USD']:
  [symbol.slice(0,3),symbol.slice(3,6),'USD'];
 for(const event of calendar.events||[]){
  if(!relevant.includes(event.currency)||!['high','medium'].includes(event.impact))continue;
  const t=Date.parse(event.scheduledAt);
  if(!Number.isFinite(t))continue;
  const mins=(t-at)/60000;
  if(mins<=(event.impact==='high'?60:20)&&
     mins>=-(event.impact==='high'?45:15))return 'NEWS_BLOCK';
 }
 return null;
}
async function upstreamJSON(fetchFn,url){
 const r=await fetchFn(url,{method:'GET',
  headers:{Accept:'application/json'},cache:'no-store',
  signal:AbortSignal.timeout(5500)});
 const size=Number(r.headers.get('content-length')||0);
 if(!r.ok||(size>0&&size>MAX_RESPONSE))throw Error('Source unavailable');
 const text=await r.text();
 if(text.length>MAX_RESPONSE)throw Error('Source exceeds size limit');
 return JSON.parse(text);
}
async function cryptoBars(symbol,fetchFn){
 // Binance USDT perpetual, then independently identified Bybit/OKX USDT
 // perpetuals. No spot USD substitution is permitted for signal evaluation.
 try{
  const rows=await upstreamJSON(fetchFn,
   'https://fapi.binance.com/fapi/v1/klines?symbol='+symbol+'&interval=1h&limit=350');
  if(!Array.isArray(rows)||rows.length<260||rows.length>350)
   throw Error('Insufficient Binance futures history');
  return {
   source:'Binance USD-M perpetual futures',exchange:'binance',
   bars:rows.map(r=>({
    time:Number(r?.[0]),closeTime:Number(r?.[6]),
    open:Number(r?.[1]),high:Number(r?.[2]),low:Number(r?.[3]),
    close:Number(r?.[4]),volume:Number(r?.[5])
   }))
  };
 }catch{
  const other=await getAlternativePerpetual(symbol,'1h',{
   fetchFn,limit:350,minBars:260
  });
  return {source:other.source,exchange:other.exchange,bars:other.bars};
 }
}
async function exchangePrice(feed,symbol,fetchFn){
 let price;
 if(feed.exchange==='binance'){
  const doc=await upstreamJSON(fetchFn,
   'https://fapi.binance.com/fapi/v1/ticker/price?symbol='+symbol);
  if(doc?.symbol!==symbol)throw Error('Binance ticker mismatched');
  price=Number(doc?.price);
 }else price=await getPerpetualTicker(feed,symbol,{fetchFn});
 if(!Number.isFinite(price)||price<=0)
  throw Error('Unverified exchange ticker');
 return price;
}

async function forexBars(symbol,fetchFn){
 const ticker=FX[symbol];
 if(!ticker)throw Error('Unsupported indicative FX pair');
 // Indicative Yahoo history is useful for checking data availability only;
 // it must never become an automatic executable FX signal.
 const hosts=['query1.finance.yahoo.com','query2.finance.yahoo.com'];
 const results=await Promise.allSettled(hosts.map(async host=>{
  const data=await upstreamJSON(fetchFn,'https://'+host+
   '/v8/finance/chart/'+encodeURIComponent(ticker)+
   '?range=60d&interval=60m');
  const chart=data?.chart?.result?.[0],quote=chart?.indicators?.quote?.[0];
  if(!Array.isArray(chart?.timestamp)||!quote||chart.timestamp.length<260)
   throw Error('Incomplete indicative history');
  return chart.timestamp.map((t,i)=>({
   time:Number(t)*1000,closeTime:Number(t)*1000+HOUR-1,
   open:Number(quote.open?.[i]),high:Number(quote.high?.[i]),
   low:Number(quote.low?.[i]),close:Number(quote.close?.[i]),volume:0
  }));
 }));
 const found=results.find(x=>x.status==='fulfilled');
 if(!found)throw Error('Indicative FX history unavailable');
 return found.value;
}
export const SCAN_MINUTES=Object.freeze([7,8,9,10]);
export function selectCronShard(scheduledTime,cryptoSymbols=CRYPTO,forexSymbols=Object.keys(FX)){
 if(!Number.isFinite(scheduledTime)||scheduledTime<1600000000000)
  return {valid:false,slot:-1,markets:[]};
 const at=new Date(scheduledTime),slot=SCAN_MINUTES.indexOf(at.getUTCMinutes());
 if(slot<0)return {valid:false,slot:-1,markets:[]};
 const markets=[
  ...cryptoSymbols.map(symbol=>({market:'crypto',symbol})),
  ...forexSymbols.map(symbol=>({market:'forex',symbol}))
 ];
 const selected=markets.filter((_,i)=>i%SCAN_MINUTES.length===slot);
 return {valid:true,slot,markets:selected,
  hourKey:new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),
   at.getUTCDate(),at.getUTCHours(),0,0)).toISOString()};
}

export function createAutoScanner({
 fetchFn=globalThis.fetch,now=Date.now,cryptoImpl=globalThis.crypto,
 researchHandler=null,cryptoSymbols=CRYPTO,forexSymbols=Object.keys(FX)
}={}){
 const research=researchHandler||createResearch({fetchFn,now});
 async function run({symbols:nullOrSymbols=null,env=null}={}){
  const at=now();
  // A private Supabase pg_net cache can recover a weekly event feed that is
  // inaccessible directly from this Cloudflare edge. It remains ONE source.
  // This is sufficient for dry-run research, NEVER for a premium publication.
  let calendar=null;
  if(!researchHandler&&env)
   calendar=await readWeeklyCalendar(fetchFn,env,{now});
  if(!calendar){
   const calendarResponse=await research(
    new Request('https://scanner.internal/api/research?mode=calendar&symbol=BTCUSDT'));
   if(!calendarResponse.ok)throw Error('Economic calendar unavailable');
   calendar=await calendarResponse.json();
  }
  if(!['FULL_WEEK','SINGLE_SOURCE_WEEKLY'].includes(calendar?.coverage)||
     !Array.isArray(calendar.events)||
     !Number.isFinite(Date.parse(calendar.checkedAt))||
     at-Date.parse(calendar.checkedAt)>MAX_AGE||
     Date.parse(calendar.checkedAt)>at+60000)
   return {status:'BLOCKED_NEWS_DATA',dryRun:true,published:0,
    scanned:0,qualified:0,counts:{NEWS_UNVERIFIED:0},
    strategy:STRATEGY,checkedAt:new Date(at).toISOString()};
  const symbols=nullOrSymbols||[
   ...cryptoSymbols.map(symbol=>({market:'crypto',symbol})),
   ...forexSymbols.map(symbol=>({market:'forex',symbol}))
  ];
  // Per-symbol errors are recorded as unavailable, never interpreted as a
  // profitable trade or cleared event risk. Concurrency stays bounded.
  const rows=[];
  for(let i=0;i<symbols.length;i+=3){
   rows.push(...await Promise.all(symbols.slice(i,i+3).map(async item=>{
    try{
     const feed=item.market==='crypto'?
      await cryptoBars(item.symbol,fetchFn):
      {source:'Yahoo Finance indicative FX',exchange:null,
       bars:await forexBars(item.symbol,fetchFn)};
     const candidate=evaluate(item.symbol,item.market,feed.bars,at);
     if(candidate.status!=='CANDIDATE')
      return {...item,status:'NO_SETUP'};
     const risk=calendarRisk(calendar,item.symbol,at);
     if(risk)return {...item,status:risk};
     if(item.market==='forex')return {...item,status:'INDICATIVE_ONLY'};
     // A closed-candle entry can drift significantly before the scanner runs.
     // A candidate is not qualified until the SAME exchange's current trade
     // price agrees with its completed-candle entry within 0.20 ATR.
     let price;
     try{price=await exchangePrice(feed,item.symbol,fetchFn)}
     catch{return {...item,status:'TICKER_UNAVAILABLE'}}
     if(Math.abs(price-candidate.entry)>candidate.atr*.20)
      return {...item,status:'PRICE_DRIFT'};
     return {...item,status:calendar.coverage==='FULL_WEEK'?
      'CANDIDATE_UNPUBLISHED':'CANDIDATE_NEWS_UNVERIFIED'};
    }catch{return {...item,status:'DATA_UNAVAILABLE'}}
   })));
  }
  const counts={};
  for(const row of rows)counts[row.status]=(counts[row.status]||0)+1;
  return {status:counts.DATA_UNAVAILABLE?'PARTIAL_DATA':'SCAN_COMPLETED',
   dryRun:true,published:0,qualified:counts.CANDIDATE_UNPUBLISHED||0,
   researchOnlyCandidates:counts.CANDIDATE_NEWS_UNVERIFIED||0,
   newsCoverage:calendar.coverage,publicationReady:false,
   scanned:rows.length,counts,strategy:STRATEGY,
   checkedAt:new Date(at).toISOString(),
   sources:{crypto:'Exchange-specific Binance, Bybit or OKX closed USDT perpetual candles',
    forex:'Yahoo historical indicative data — ineligible for publication'},
   // Deliberately omit candidate levels, sides, private analysis and evidence.
   results:rows.map(({symbol,market,status})=>({symbol,market,status}))};
 }
 async function handle(request,env){
  if(request.method!=='POST')return reply({error:'POST only'},405);
  if(!await verifyScanSignature(request,env,{now,cryptoImpl}))
   return reply({error:'Unauthorized'},401);
  if(env?.SC_AUTO_RESEARCH_ENABLED!=='true')
   return reply({error:'Automated research staging is not enabled'},503);
  try{
   const result=await run({env});
   return reply(result,result.status==='BLOCKED_NEWS_DATA'?503:200);
  }catch{
   return reply({error:'Automated research unavailable; no signals published'},503);
  }
 }
 async function scheduled(env,scheduledTime){
  // Cloudflare Workers Free has a strict 10ms per-Cron CPU budget.
  // Four tiny, disjoint shards run at minutes 7/8/9/10 after the hour.
  // Invalid/ad-hoc scheduled events perform no network or database work.
  if(env?.SC_AUTO_RESEARCH_ENABLED!=='true')return {status:'DISABLED',published:0};
  const shard=selectCronShard(scheduledTime,cryptoSymbols,forexSymbols);
  if(!shard.valid||!shard.markets.length)return {status:'IGNORED_SCHEDULE',published:0};
  try{
   const result=await run({symbols:shard.markets,env});
   const audit=await saveDryRunAudit(fetchFn,env,{
    ...result,slot:shard.slot,hourKey:shard.hourKey
   });
   console.info('SignalChart sharded hourly DRY RUN',JSON.stringify({
    hourKey:shard.hourKey,slot:shard.slot,
    status:result.status,scanned:result.scanned,
    qualified:result.qualified,published:0,counts:result.counts,
    auditSaved:audit.saved
   }));
   return {...result,slot:shard.slot,hourKey:shard.hourKey,
    auditSaved:audit.saved};
  }catch{
   // An audit failure must never become a permission to publish.
   const failure={status:'ERROR',scanned:0,qualified:0,published:0,counts:{},
    slot:shard.slot,hourKey:shard.hourKey};
   await saveDryRunAudit(fetchFn,env,failure);
   console.warn('SignalChart sharded research check failed; no signals published');
   return failure;
  }
 }
 return {run,handle,scheduled};
}
