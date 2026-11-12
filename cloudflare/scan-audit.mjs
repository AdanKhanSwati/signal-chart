/**
 * Private, append-only audit for Cloudflare hourly research dry runs.
 * This NEVER calls the premium signal publication RPC, updates subscriptions,
 * or stores customer details, trade levels, or forecasts.
 *
 * Not part of the customer-facing HTTP endpoint. Native Cron uses this after
 * read-only scan completion. Database validation remains authoritative.
 */
const URL=/^https:\/\/[a-z0-9-]+\.supabase\.co$/;
const NEW_KEY=/^sb_secret_[A-Za-z0-9_-]{20,}$/;
const LEGACY_KEY=/^eyJ[A-Za-z0-9._-]{80,}$/;
const SAFE_MARKETS=new Set(['crypto','forex']);
const SAFE_STATUSES=new Set([
 'DATA_UNAVAILABLE','NO_SETUP','NEWS_BLOCK','NEWS_UNVERIFIED',
 'INDICATIVE_ONLY','TICKER_UNAVAILABLE','PRICE_DRIFT',
 'CANDIDATE_UNPUBLISHED','CANDIDATE_NEWS_UNVERIFIED'
]);
const SAFE_DIAGNOSTICS=new Set([
 'INSUFFICIENT_HISTORY','STALE_CANDLES','GAPPED_CANDLES',
 'INCOMPLETE_SOURCE','INVALID_SOURCE','PROVIDER_UNAVAILABLE'
]);
const SAFE_SOURCES=new Set([
 'Binance USD-M perpetual futures','Bybit USDT linear perpetual',
 'OKX USDT-margined swap perpetual','Yahoo Finance indicative FX'
]);
export function safeScanResults(report){
 const items=Array.isArray(report?.results)?report.results:[];
 return items.slice(0,24).flatMap(x=>{
  if(!x||!SAFE_MARKETS.has(x.market)||
     !/^[A-Z0-9]{6,20}$/.test(String(x.symbol||''))||
     !SAFE_STATUSES.has(x.status))return [];
  const entry={symbol:x.symbol,market:x.market,status:x.status};
  if(SAFE_DIAGNOSTICS.has(x.diagnostic))entry.diagnostic=x.diagnostic;
  if(SAFE_SOURCES.has(x.source))entry.source=x.source;
  return [entry];
 });
}

export function scanAuditPayload(report){
 const status=report?.status==='BLOCKED_NEWS_DATA'?'BLOCKED_NEWS_DATA':
  report?.status==='SCAN_COMPLETED'?'COMPLETED':
  report?.status==='PARTIAL_DATA'?'PARTIAL_FAILURE':'ERROR';
 const scanned=Number(report?.scanned)||0,
  qualified=Number(report?.qualified)||0,
  errors=Number(report?.counts?.DATA_UNAVAILABLE)||0;
 if(![scanned,qualified,errors].every(x=>Number.isInteger(x)&&x>=0&&x<=200))
  throw Error('Invalid scan audit counts');
 return {
  p_status:status,p_scanned:scanned,p_qualified:qualified,
  p_published:0,p_errors:errors,
  p_metadata:{mode:'cloudflare_dry_run',strategy:'sc-hourly-ema-breakout-v1',
   published:false,feedStatus:report?.status||'ERROR',
   scanHour:/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(String(report?.hourKey||''))?report.hourKey:null,
   shard:Number.isInteger(report?.slot)&&report.slot>=0&&report.slot<=3?report.slot:null,
   counts:Object.fromEntries(Object.entries(report?.counts||{}).filter(
    ([name,count])=>/^[A-Z_]{1,36}$/.test(name)&&
     Number.isInteger(count)&&count>=0&&count<=200)),
   marketChecks:safeScanResults(report),
   newsCoverage:['FULL_WEEK','SINGLE_SOURCE_WEEKLY','UNKNOWN'].includes(report?.newsCoverage)?report.newsCoverage:null
  }
 };
}
export async function saveDryRunAudit(fetchFn,env,report){
 const url=String(env?.SUPABASE_URL||'').replace(/\/$/,'');
 const primary=String(env?.SUPABASE_SECRET_KEY||'');
 const legacy=String(env?.SUPABASE_SERVICE_ROLE_KEY||'');
 const secret=NEW_KEY.test(primary)?primary:LEGACY_KEY.test(legacy)?legacy:null;
 if(!URL.test(url)||!secret)return {saved:false,reason:'NOT_CONFIGURED'};
 const data=scanAuditPayload(report);
 try{
  const response=await fetchFn(url+'/rest/v1/rpc/sc_record_auto_scan',{
   method:'POST',
   headers:{apikey:secret,'Content-Type':'application/json',
    ...(secret===legacy?{Authorization:'Bearer '+secret}:{})},
   body:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(6000)
  });
  if(!response.ok)return {saved:false,reason:'AUDIT_FAILED'};
  return {saved:true};
 }catch{return {saved:false,reason:'AUDIT_FAILED'}}
}
