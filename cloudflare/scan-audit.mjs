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
     Number.isInteger(count)&&count>=0&&count<=200))
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
