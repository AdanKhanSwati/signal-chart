/**
 * Private server-side weekly macro calendar snapshot from Supabase.
 *
 * Source: validated Forex Factory event cache fetched by Supabase pg_net.
 * The weekly aggregator is NOT independent verification for trade publication.
 * Never expose service credentials, private RPC errors or customer data.
 */
const SB_URL=/^https:\/\/[a-z0-9-]+\.supabase\.co$/;
const SB_SECRET=/^sb_secret_[A-Za-z0-9_-]{20,}$/;
const LEGACY=/^eyJ[A-Za-z0-9._-]{80,}$/;
const MAX_BYTES=115000;
const HOUR=3600000;
export async function readWeeklyCalendar(fetchFn,env,{now=Date.now}={}){
 const url=String(env?.SUPABASE_URL||'').replace(/\/$/,'');
 const newKey=String(env?.SUPABASE_SECRET_KEY||'');
 const legacy=String(env?.SUPABASE_SERVICE_ROLE_KEY||'');
 const secret=SB_SECRET.test(newKey)?newKey:LEGACY.test(legacy)?legacy:null;
 if(!SB_URL.test(url)||!secret)return null;
 try{
  const result=await fetchFn(url+'/rest/v1/rpc/sc_economic_calendar_snapshot',{
   method:'POST',
   headers:{apikey:secret,'Content-Type':'application/json',
    ...(secret===legacy?{Authorization:'Bearer '+secret}:{})},
   body:'{}',cache:'no-store',signal:AbortSignal.timeout(4500)
  });
  const length=Number(result.headers.get('content-length')||0);
  if(!result.ok||(length>0&&length>MAX_BYTES))return null;
  const text=await result.text();
  if(text.length>MAX_BYTES)return null;
  const data=JSON.parse(text);
  if(data?.coverage!=='SINGLE_SOURCE_WEEKLY'||
     data.sourceStatus!=='CURRENT'||
     data.independentlyVerified!==false||
     data.publicationApproved!==false||
     !Array.isArray(data.events)||data.events.length<1||data.events.length>500)
   return null;
  const at=Date.parse(data.checkedAt),clock=now();
  if(!Number.isFinite(at)||at>clock+60000||clock-at>90*60000)
   return null;
  const events=[];
  for(const e of data.events){
   if(!e||!/^[A-Z]{3}$/.test(String(e.currency||''))||
      !['high','medium'].includes(e.impact)||typeof e.title!=='string'||
      !e.title||e.title.length>180||
      typeof e.scheduledAt!=='string')return null;
   const eventAt=Date.parse(e.scheduledAt);
   if(!Number.isFinite(eventAt)||eventAt<clock-8*24*HOUR||
      eventAt>clock+10*24*HOUR)return null;
   if(e.source!=='Forex Factory weekly calendar')return null;
   events.push({currency:e.currency,impact:e.impact,
    scheduledAt:new Date(eventAt).toISOString()});
  }
  return {coverage:'SINGLE_SOURCE_WEEKLY',checkedAt:new Date(at).toISOString(),
   events,sourceStatus:'CURRENT',independentlyVerified:false,
   publicationApproved:false,
   note:'Single attributed weekly economic calendar — research only, not independently validated.'};
 }catch{return null}
}
