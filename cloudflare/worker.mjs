/**
 * SignalChart Cloudflare Workers Free migration adapter.
 *
 * Staging only: config, verified-member read, and trial state are implemented.
 * Everything else under /api/* remains unavailable until independently ported.
 * This file intentionally does not import @vercel/blob, Node server shims or
 * privileged secrets into published static assets.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER=/^Bearer ([A-Za-z0-9._~+/-]{20,8192}=*)$/;
const TRIAL_STATUSES=new Set(['not_activated','active','exhausted','expired','revoked','legacy_review_required']);
const issue=(status,message)=>Object.assign(new Error(message),{status});

function reply(value,status=200){
 return new Response(JSON.stringify(value),{status,headers:{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
 }});
}
function publicConfig(env){
 const base=String(env.SUPABASE_URL||'').replace(/\/+$/,'');
 const pub=String(env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY||'');
 const valid=/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)&&
  (/^sb_publishable_[\w-]{15,}$/.test(pub)||/^eyJ[\w.-]{80,}$/.test(pub));
 return {ready:valid,url:valid?base:null,key:valid?pub:null};
}
function secretConfig(env){
 const base=publicConfig(env);
 if(!base.ready)throw issue(503,'Supabase authentication is not configured');
 const secret=String(env.SUPABASE_SECRET_KEY||'');
 const legacy=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
 if(/^sb_secret_[\w-]{20,}$/.test(secret))
  return {...base,privileged:secret,legacy:false};
 if(/^eyJ[\w.-]{80,}$/.test(legacy))
  return {...base,privileged:legacy,legacy:true};
 throw issue(503,'Private account database is unavailable');
}
function privilegedHeaders(config,extra={}){
 return {apikey:config.privileged,...(config.legacy?{Authorization:'Bearer '+config.privileged}:{}),...extra};
}
function identityFromUser(user){
 const uid=String(user?.id||'').toLowerCase();
 const email=String(user?.email||'').trim().toLowerCase();
 if(!UUID.test(uid)||!email||email.length>254||!user?.email_confirmed_at)
  throw issue(401,'Verified email session required');
 return {uid,email,name:String(user?.user_metadata?.full_name||'').slice(0,100)};
}
async function remote(fetchFn,url,options,message){
 let response;
 try{response=await fetchFn(url,{...options,signal:AbortSignal.timeout(9000),cache:'no-store'})}
 catch{throw issue(503,message)}
 if(!response.ok){
  if(options.role==='auth'&&[401,403].includes(response.status))
   throw issue(401,'Invalid or expired session');
  throw issue(503,message);
 }
 try{return await response.json()}catch{throw issue(503,message)}
}
async function verifyUser(request,fetchFn,env){
 const config=publicConfig(env);
 if(!config.ready)throw issue(503,'Supabase authentication is not configured');
 const match=BEARER.exec(String(request.headers.get('Authorization')||''));
 if(!match)throw issue(401,'Sign in required');
 const user=await remote(fetchFn,config.url+'/auth/v1/user',{
  method:'GET',headers:{apikey:config.key,Authorization:'Bearer '+match[1]},role:'auth'
 },'Authentication service temporarily unavailable');
 return identityFromUser(user);
}
async function rest(fetchFn,config,method,path,body,extraHeaders={}){
 const headers=privilegedHeaders(config,{'Content-Type':'application/json',...extraHeaders});
 return remote(fetchFn,config.url+'/rest/v1/'+path,{
  method,headers,body:body===undefined?undefined:JSON.stringify(body)
 },'Private account database is temporarily unavailable');
}
async function profile(fetchFn,config,user){
 const path='sc_member_profiles?user_id=eq.'+encodeURIComponent(user.uid)+
  '&select=user_id,email,display_name,legacy_status,created_at,updated_at&limit=1';
 const find=async()=>{const rows=await rest(fetchFn,config,'GET',path);
  if(!Array.isArray(rows))throw issue(503,'Invalid account data');
  if(rows.length&&rows[0]?.user_id!==user.uid)throw issue(503,'Account identity mismatch');
  return rows[0]||null;
 };
 let row=await find();
 if(row)return row;
 // Insert-on-conflict-ignore only. Existing email/history and status are
 // immutable in this login path. DO NOT insert role or trial flags here.
 await rest(fetchFn,config,'POST','sc_member_profiles?on_conflict=user_id',{
  user_id:user.uid,email:user.email,display_name:user.name
 },{Prefer:'resolution=ignore-duplicates,return=representation'});
 row=await find();
 if(!row)throw issue(503,'Account profile could not be verified');
 return row;
}
async function trialState(fetchFn,config,uid){
 const state=await rest(fetchFn,config,'POST','rpc/sc_trial_state',{p_user:uid});
 if(!state||typeof state!=='object'||!TRIAL_STATUSES.has(state.trialStatus))
  throw issue(503,'Invalid trial status');
 const used=Number(state.signalsUsed),remaining=Number(state.signalsRemaining);
 if(!Number.isInteger(used)||used<0||used>3||
    !Number.isInteger(remaining)||remaining<0||remaining>3)
  throw issue(503,'Invalid trial credits');
 return {...state,serverNow:new Date().toISOString()};
}
async function sqlPaid(fetchFn,config,uid){
 const path='sc_paid_access?user_id=eq.'+encodeURIComponent(uid)+
  '&select=user_id,starts_at,expires_at,revoked_at,source'+
  '&order=expires_at.desc&limit=30';
 const rows=await rest(fetchFn,config,'GET',path);
 if(!Array.isArray(rows))throw issue(503,'Invalid payment entitlement response');
 const now=Date.now();
 const live=rows.filter(row=>{
  if(row?.user_id!==uid)throw issue(503,'Entitlement identity mismatch');
  return row.revoked_at===null&&
   Number.isFinite(Date.parse(row.starts_at))&&Date.parse(row.starts_at)<=now&&
   Number.isFinite(Date.parse(row.expires_at))&&Date.parse(row.expires_at)>now&&
   ['verified_crypto_payment','legacy_verified_payment'].includes(row.source);
 });
 live.sort((a,b)=>Date.parse(b.expires_at)-Date.parse(a.expires_at));
 return live.length?live[0].expires_at:null;
}
function trialAllows(state){
 const expires=Date.parse(String(state.expiresAt||''));
 if(!Number.isFinite(expires)||expires<=Date.now())return false;
 if(state.trialStatus==='active')return state.signalsRemaining>0;
 if(state.trialStatus==='exhausted')return state.signalsUsed===3;
 return false;
}
function apiConfig(env){
 const config=publicConfig(env);
 return {
  brand:'SignalChart',authProvider:'supabase',authReady:config.ready,
  supabaseUrl:config.url,supabaseAnonKey:config.key,
  trialHours:72,trialSignalLimit:3,requiresVerifiedPhone:false,
  requiresVerifiedEmail:true,trialVerificationMethod:'verified_email_browser',
  emailDeviceTrialEnabled:false,turnstileSiteKey:null,
  phoneVerificationChannel:'disabled',phoneVerificationEnabled:false,
  renewalDays:30,monthlyUSD:20,priceCurrency:'USD',
  walletNetwork:'BTC mainnet',
  paymentMethod:'Manual BTC transfer after administrator verification',
  signalsEnabled:false,paymentsEnabled:false,hourlySignals:'disabled'
 };
}
async function getMember(request,env,fetchFn){
 const user=await verifyUser(request,fetchFn,env);
 const config=secretConfig(env);
 const saved=await profile(fetchFn,config,user);
 const [state,paidUntil]=await Promise.all([
  trialState(fetchFn,config,user.uid),
  sqlPaid(fetchFn,config,user.uid)
 ]);
 const activeTrial=trialAllows(state),paid=!!paidUntil;
 const status=paid?'active':activeTrial?'trial':'locked';
 const account={
  uid:user.uid,email:user.email,name:saved.display_name||user.name,
  status,access:paid||activeTrial,isAdmin:false,paidUntil,
  manualEndsAt:null,trialStatus:state.trialStatus,
  trialStartedAt:state.activatedAt||null,trialEndsAt:state.expiresAt||null,
  signalsUsed:state.signalsUsed,signalsRemaining:state.signalsRemaining,
  accessUntil:paid?paidUntil:activeTrial?state.expiresAt:null,
  legacyHistoryStatus:saved.legacy_status,
  legacyRecoveryPending:saved.legacy_status==='unreconciled'
 };
 // No legacy payment history is fabricated. Payment collection stays disabled.
 return {account,payment:{
  enabled:false,priceUSD:20,network:'BTC mainnet',wallet:null,amountBTC:null
 },requests:[],migration:{
  incomplete:true,legacyHistoryPending:account.legacyRecoveryPending,
  billingAvailable:false,signalsAvailable:false
 }};
}
function safeError(error){
 const status=[400,401,403,404,405,409,429,503].includes(error?.status)?error.status:500;
 return reply({error:status===500?'The service is temporarily unavailable':error.message},status);
}
export function createWorker({fetchFn=globalThis.fetch}={}){
 return {
  async fetch(request,env){
   try{
    const url=new URL(request.url);
    if(url.pathname==='/api/config'){
     if(request.method!=='GET')throw issue(405,'Method not allowed');
     return reply(apiConfig(env));
    }
    if(url.pathname==='/api/health'){
     if(request.method!=='GET')throw issue(405,'Method not allowed');
     return reply({ok:true,brand:'SignalChart',phase:'cloudflare-staging'});
    }
    if(url.pathname==='/api/trial'){
     if(request.method!=='GET'||url.searchParams.get('action')!=='state')
      throw issue(503,'Trial activation is unavailable during migration');
     const user=await verifyUser(request,fetchFn,env);
     const state=await trialState(fetchFn,secretConfig(env),user.uid);
     return reply(state);
    }
    if(url.pathname==='/api/member'){
     if(request.method!=='GET'||url.searchParams.get('action')!=='me')
      throw issue(503,'Membership changes are unavailable during migration');
     return reply(await getMember(request,env,fetchFn));
    }
    if(url.pathname.startsWith('/api/'))
     throw issue(503,'This API route is not yet migrated');
    if(!env.ASSETS?.fetch)throw issue(503,'Static assets are not configured');
    return env.ASSETS.fetch(request);
   }catch(e){return safeError(e)}
  }
 };
}
export default createWorker();
