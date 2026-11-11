import {listMarkets} from './market-catalog.mjs';

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
 return {uid,email,name:String(user?.user_metadata?.full_name||'').slice(0,100),
  createdAt:String(user?.created_at||'')};
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

/** Free-tier browser trial registration; disabled until ALL secrets and cutoff
 * are configured. Records are granted only by the pre-existing transactional
 * Supabase RPC. Browser/IP hints never grant membership by themselves. */
const COOKIE_NAME='__Host-sc_trial_device';
const COOKIE_TOKEN=/^[A-Za-z0-9_-]{43}$/;
const HEX=/^[0-9a-f]{64}$/;
function browserTrialConfig(env){
 const enabled=env.SC_EMAIL_DEVICE_TRIAL_ENABLED==='true'&&
  typeof env.SC_TRIAL_HMAC_SECRET==='string'&&env.SC_TRIAL_HMAC_SECRET.length>=32&&
  typeof env.SC_TURNSTILE_SITE_KEY==='string'&&env.SC_TURNSTILE_SITE_KEY.length>5&&
  typeof env.SC_TURNSTILE_SECRET_KEY==='string'&&env.SC_TURNSTILE_SECRET_KEY.length>=20&&
  Number.isFinite(Date.parse(String(env.SC_TRIAL_ROLLOUT_AT||'')))&&
  !!(env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY)&&
  publicConfig(env).ready;
 return {enabled,siteKey:enabled?env.SC_TURNSTILE_SITE_KEY:null};
}
function urlSafe(bytes){
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function rawBytes(base64url){
 if(!COOKIE_TOKEN.test(base64url||''))return null;
 try{
  const arr=Uint8Array.from(atob(base64url.replace(/-/g,'+').replace(/_/g,'/')+'='),x=>x.charCodeAt(0));
  return arr.length===32?arr:null;
 }catch{return null}
}
async function browserKey(env){
 const secret=String(env.SC_TRIAL_HMAC_SECRET||'');
 if(secret.length<32)throw issue(503,'Browser trial signing is not configured');
 return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function hmac(key,value){
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)));
 return bytes;
}
async function browserCookie(request,env){
 const line=request.headers.get('Cookie')||'';
 const part=line.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+'='));
 if(!part)return null;
 const [id,signature,...extra]=part.slice(COOKIE_NAME.length+1).split('.');
 if(extra.length||!COOKIE_TOKEN.test(id||'')||!COOKIE_TOKEN.test(signature||''))return null;
 const mac=rawBytes(signature);
 if(!mac)return null;
 const key=await browserKey(env);
 const valid=await crypto.subtle.verify('HMAC',key,mac,new TextEncoder().encode('sc-v1-browser:'+id));
 return valid?id:null;
}
async function browserDeviceStart(request,env,fetchFn){
 if(!browserTrialConfig(env).enabled)throw issue(503,'Secure browser trial activation is not configured');
 await verifyUser(request,fetchFn,env);
 let id=await browserCookie(request,env),fresh=false;
 if(!id){id=urlSafe(crypto.getRandomValues(new Uint8Array(32)));fresh=true}
 const key=await browserKey(env);
 const signature=urlSafe(await hmac(key,'sc-v1-browser:'+id));
 const response=reply({ready:true,newCookie:fresh,
  message:'Secure browser recognition is ready; shared networks do not automatically block a trial.'});
 if(fresh)response.headers.set('Set-Cookie',COOKIE_NAME+'='+id+'.'+signature+
  '; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax');
 return response;
}
async function confirmTurnstile(fetchFn,request,env,token){
 if(typeof token!=='string'||token.length<12||token.length>2048)
  throw issue(400,'Complete the anti-bot challenge');
 const expectedHost=new URL(request.url).hostname.toLowerCase();
 const params=new URLSearchParams({secret:env.SC_TURNSTILE_SECRET_KEY,response:token});
 let response;
 try{
  response=await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
   method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:params.toString(),signal:AbortSignal.timeout(8000),cache:'no-store'
  });
 }catch{throw issue(503,'Anti-bot verification is unavailable')}
 if(!response.ok)throw issue(503,'Anti-bot verification is unavailable');
 let result;try{result=await response.json()}catch{throw issue(503,'Anti-bot verification is unavailable')}
 if(result?.success!==true||result.action!=='trial_activate'||
    String(result.hostname||'').toLowerCase()!==expectedHost)
  throw issue(403,'Anti-bot verification failed');
}
async function activateBrowser(request,env,fetchFn){
 if(!browserTrialConfig(env).enabled)throw issue(503,'Secure browser trial activation is not configured');
 const person=await verifyUser(request,fetchFn,env);
 const config=secretConfig(env);
 const current=await trialState(fetchFn,config,person.uid);
 if(current.trialStatus!=='not_activated')
  return {status:'existing_trial',trial:current};
 // The previously deployed Vercel Blob record store is suspended, therefore
 // an account created before the original trial rollout cannot be cleared here.
 // Existing accounts require independent manual historical eligibility review.
 const created=Date.parse(person.createdAt);
 const cutoff=Date.parse(String(env.SC_TRIAL_ROLLOUT_AT||''));
 if(!Number.isFinite(created)||!Number.isFinite(cutoff))
  throw issue(503,'Historical trial eligibility is unavailable');
 if(created<cutoff)throw issue(409,'Existing accounts need a historical trial eligibility review');
 const id=await browserCookie(request,env);
 if(!id)throw issue(428,'Initialize secure browser recognition and keep cookies enabled');
 let body;
 const len=Number(request.headers.get('content-length')||0);
 if(!Number.isFinite(len)||len>5000)throw issue(413,'Trial activation request is too large');
 try{body=await request.text();if(body.length>5000)throw Error('too large');body=JSON.parse(body)}
 catch{throw issue(400,'Invalid trial activation request')}
 await confirmTurnstile(fetchFn,request,env,body.turnstileToken);
 const key=await browserKey(env);
 const fingerprint=async value=>Array.from(await hmac(key,value),v=>v.toString(16).padStart(2,'0')).join('');
 const ip=String(request.headers.get('CF-Connecting-IP')||'').slice(0,70);
 const result=await rest(fetchFn,config,'POST','rpc/sc_activate_browser_trial',{
  p_user:person.uid,
  p_device_hash:await fingerprint('browser-cookie:'+id),
  p_network_hash:ip?await fingerprint('net:'+ip):null
 });
 if(!result||typeof result.result!=='string')throw issue(503,'Trial activation response invalid');
 return {status:result.result,trial:result.trial||null,message:result.message||null};
}

function apiConfig(env){
 const config=publicConfig(env),trialCfg=browserTrialConfig(env);
 return {
  brand:'SignalChart',authProvider:'supabase',authReady:config.ready,
  supabaseUrl:config.url,supabaseAnonKey:config.key,
  trialHours:72,trialSignalLimit:3,requiresVerifiedPhone:false,
  requiresVerifiedEmail:true,trialVerificationMethod:'verified_email_browser',
  emailDeviceTrialEnabled:trialCfg.enabled,turnstileSiteKey:trialCfg.siteKey,
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
 const status=[400,401,403,404,405,409,413,428,429,503].includes(error?.status)?error.status:500;
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
     const action=url.searchParams.get('action');
     if(request.method==='GET'&&action==='state'){
      const user=await verifyUser(request,fetchFn,env);
      return reply(await trialState(fetchFn,secretConfig(env),user.uid));
     }
     if(request.method==='GET'&&action==='device')
      return await browserDeviceStart(request,env,fetchFn);
     if(request.method==='POST'&&action==='activate_browser')
      return reply(await activateBrowser(request,env,fetchFn));
     throw issue(503,'This trial operation is unavailable during migration');
    }
    if(url.pathname==='/api/member'){
     if(request.method!=='GET'||url.searchParams.get('action')!=='me')
      throw issue(503,'Membership changes are unavailable during migration');
     return reply(await getMember(request,env,fetchFn));
    }
    if((url.pathname==='/api/markets'||
        (url.pathname==='/api/candles'&&url.searchParams.get('action')==='markets'))&&
        request.method==='GET')
     return await listMarkets({fetchFn});
    if(url.pathname.startsWith('/api/'))
     throw issue(503,'This API route is not yet migrated');
    if(!env.ASSETS?.fetch)throw issue(503,'Static assets are not configured');
    return env.ASSETS.fetch(request);
   }catch(e){return safeError(e)}
  }
 };
}
export default createWorker();
