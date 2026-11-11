import {listMarkets} from './market-catalog.mjs';
import {getCandles} from './market-candles.mjs';

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
 // Reject non-canonical base64url encodings that alter only unused pad bits.
 if(!mac||urlSafe(mac)!==signature)return null;
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

const SIGNAL_KEY=/^[a-zA-Z0-9][a-zA-Z0-9:_.-]{2,139}$/;
function premiumConfigured(env){
 // Deliberately disabled until old Blob entitlements have been reconciled.
 return env.SC_PREMIUM_UNLOCK_ENABLED==='true';
}
async function premiumList(url,env,fetchFn){
 if(!premiumConfigured(env))return reply({signals:[]});
 const market=url.searchParams.get('market');
 if(market!==null&&market!=='crypto'&&market!=='forex')
  throw issue(400,'Invalid market');
 const signals=await rest(fetchFn,secretConfig(env),'POST','rpc/sc_signal_public_list',{
  p_market:market||null,p_limit:50
 });
 if(!Array.isArray(signals))throw issue(503,'Signal catalog is unavailable');
 // Explicit response allowlist: no premium_data, entries, strategies, targets,
 // stops, position sizing or provider-private fields in public GET.
 const publicSignals=signals.filter(s=>
  s&&typeof s.signalKey==='string'&&SIGNAL_KEY.test(s.signalKey)&&
  ['crypto','forex'].includes(s.market)&&typeof s.asset==='string'&&
  s.asset.length>0&&s.asset.length<=64)
 .slice(0,50)
 .map(s=>({signalKey:s.signalKey,market:s.market,asset:s.asset,
  publishedAt:s.publishedAt||null}));
 return reply({signals:publicSignals});
}
async function premiumUnlock(request,env,fetchFn){
 if(!premiumConfigured(env))
  throw issue(503,'Premium signals are disabled during migration');
 if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
  throw issue(415,'Expected JSON request');
 const length=Number(request.headers.get('Content-Length')||0);
 if(!Number.isFinite(length)||length<0||length>5000)
  throw issue(413,'Premium request is too large');
 const user=await verifyUser(request,fetchFn,env);
 let body;
 try{
  const raw=await request.text();
  if(raw.length>5000)throw Error('Request too large');
  body=JSON.parse(raw);
 }catch{throw issue(400,'Invalid premium request')}
 const signalKey=body?.signalKey;
 if(typeof signalKey!=='string'||!SIGNAL_KEY.test(signalKey))
  throw issue(400,'Invalid premium signal reference');
 const config=secretConfig(env);
 // Payment and membership claims are never read from the browser.
 // For paid members, SQL verifies an active, unrevoked verified grant;
 // for trial members, sc_unlock_trial itself is transactional and prevents a
 // fourth unique signal across concurrent devices while permitting reopen.
 const paidUntil=await sqlPaid(fetchFn,config,user.uid);
 let result;
 if(paidUntil){
  const detail=await rest(fetchFn,config,'POST','rpc/sc_signal_detail_server',{
   p_signal_key:signalKey
  });
  result=detail?.found===true?
   {allowed:true,reason:'membership',signal:detail.data,signalKey}:
   {allowed:false,reason:'not_found'};
 }else{
  const claim=await rest(fetchFn,config,'POST','rpc/sc_unlock_trial',{
   p_user:user.uid,p_signal_key:signalKey
  });
  if(!claim||typeof claim!=='object'||typeof claim.allowed!=='boolean')
   throw issue(503,'Premium entitlement service is unavailable');
  result={allowed:claim.allowed,reason:claim.reason||'denied',
   signal:claim.allowed?claim.data:null,signalKey,
   signalsUsed:claim.signalsUsed??null,
   signalsRemaining:claim.signalsRemaining??null,
   trialExhausted:claim.trialExhausted===true};
 }
 if(!result.allowed){
  const reason=result.reason;
  return reply({
   error:reason==='trial_exhausted'?
    'All 3 trial signals have been used. Upgrade to continue.':
    reason==='phone_verification_required'?
    'Verify your email and activate your free trial in Account.':
    reason==='trial_expired'?'Trial expired. Upgrade to continue.':
    reason==='not_found'?'Signal not found':
    'Premium access requires an active membership.',
   reason,signalsUsed:result.signalsUsed??null,
   signalsRemaining:result.signalsRemaining??null
  },reason==='not_found'?404:403);
 }
 if(result.signal===null||typeof result.signal!=='object'||
    Array.isArray(result.signal))
  throw issue(503,'Premium signal payload is unavailable');
 // Private no-store reply. Never cache entitlement-bearing signal data.
 return reply(result);
}


const SUPPORT_CATEGORIES=new Set(['general','billing','technical','complaint']);
async function memberTickets(fetchFn,config,uid){
 const query='sc_support_tickets?user_id=eq.'+encodeURIComponent(uid)+
  '&select=id,user_id,subject,category,status,updated_at&order=updated_at.desc&limit=50';
 const rows=await rest(fetchFn,config,'GET',query);
 if(!Array.isArray(rows))throw issue(503,'Support inbox is unavailable');
 return rows.map(row=>{
  if(row?.user_id!==uid||!UUID.test(row.id))throw issue(503,'Support inbox identity mismatch');
  return {ticketId:row.id,uid:row.user_id,subject:row.subject,
   category:row.category,status:row.status,lastAt:row.updated_at};
 });
}
function supportAdmin(user,env){
 const target=String(env.SC_SUPER_ADMIN_UID||'').toLowerCase();
 return UUID.test(target)&&target===user.uid;
}
async function supportTicket(fetchFn,config,ticketId,user,env){
 if(!UUID.test(ticketId||''))throw issue(400,'Invalid support conversation reference');
 const query='sc_support_tickets?id=eq.'+encodeURIComponent(ticketId)+
  '&select=id,user_id,subject,category,status,updated_at&limit=1';
 const rows=await rest(fetchFn,config,'GET',query);
 if(!Array.isArray(rows))throw issue(503,'Support conversation unavailable');
 const row=rows[0];
 // Other users' ticket existence is never disclosed.
 if(!row||row.id!==ticketId)return null;
 if(row.user_id!==user.uid&&!supportAdmin(user,env))return null;
 return {ticketId:row.id,uid:row.user_id,subject:row.subject,
  category:row.category,status:row.status,lastAt:row.updated_at};
}
async function supportMessages(fetchFn,config,ticket){
 const query='sc_support_messages?ticket_id=eq.'+encodeURIComponent(ticket.ticketId)+
  '&select=ticket_id,sender_type,message,created_at&order=created_at.asc&limit=200';
 const rows=await rest(fetchFn,config,'GET',query);
 if(!Array.isArray(rows))throw issue(503,'Support messages unavailable');
 return rows.map(row=>{
  if(row?.ticket_id!==ticket.ticketId)throw issue(503,'Support message identity mismatch');
  return {from:row.sender_type==='admin'?'admin':'customer',
   text:row.message,at:row.created_at};
 });
}
async function supportRequest(request,action,env,fetchFn,url){
 const user=await verifyUser(request,fetchFn,env);
 const config=secretConfig(env);
 if(request.method==='GET'&&action==='messages'){
  const ticket=await supportTicket(fetchFn,config,url.searchParams.get('ticketId'),user,env);
  if(!ticket)throw issue(404,'Support conversation not found');
  return reply({ticket,messages:await supportMessages(fetchFn,config,ticket)});
 }
 if(request.method!=='POST'||!['new_ticket','reply','close_ticket'].includes(action))
  throw issue(503,'This support operation is unavailable');
 const length=Number(request.headers.get('Content-Length')||0);
 if(!Number.isFinite(length)||length<0||length>5000)throw issue(413,'Support request is too large');
 if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
  throw issue(415,'Expected JSON request');
 let body;
 try{const text=await request.text();if(text.length>5000)throw Error('large');body=JSON.parse(text)}
 catch{throw issue(400,'Invalid support request')}
 if(action==='new_ticket'){
  const subject=body?.subject,category=body?.category,message=body?.message;
  if(typeof subject!=='string'||subject.trim().length<4||subject.trim().length>140||
     !SUPPORT_CATEGORIES.has(category)||typeof message!=='string'||
     message.trim().length<1||message.trim().length>2000)
   throw issue(400,'Invalid support ticket details');
  const outcome=await rest(fetchFn,config,'POST','rpc/sc_support_create',{
   p_actor:user.uid,p_subject:subject.trim(),p_category:category,p_message:message.trim()
  });
  if(!UUID.test(outcome?.ticketId||''))throw issue(503,'Support ticket could not be confirmed');
  return reply({ticketId:outcome.ticketId,status:'open'},201);
 }
 const ticketId=body?.ticketId;
 const ticket=await supportTicket(fetchFn,config,ticketId,user,env);
 if(!ticket)throw issue(404,'Support conversation not found');
 const admin=supportAdmin(user,env);
 const params={p_actor:user.uid,p_ticket:ticketId,p_admin:admin};
 if(action==='reply'){
  const message=body?.message;
  if(typeof message!=='string'||!message.trim()||message.trim().length>2000)
   throw issue(400,'Invalid support reply');
  params.p_message=message.trim();
 }
 const procedure=action==='reply'?'sc_support_reply':'sc_support_close';
 const outcome=await rest(fetchFn,config,'POST','rpc/'+procedure,params);
 if(outcome?.status==='forbidden')throw issue(403,'You cannot access this conversation');
 if(outcome?.status==='not_found')throw issue(404,'Support conversation not found');
 if(outcome?.status==='rate_limited')throw issue(429,'Support messages are temporarily rate-limited');
 if(outcome?.status==='closed'&&action==='reply')throw issue(409,'This conversation is closed');
 if(!['sent','closed'].includes(outcome?.status))throw issue(503,'Support operation was not confirmed');
 return reply({ticketId,status:outcome.status});
}

function safeError(error){
 const status=[400,401,403,404,405,409,413,415,428,429,503].includes(error?.status)?error.status:500;
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
    if(url.pathname==='/api/premium-signals'){
     const action=url.searchParams.get('action');
     if(request.method==='GET'&&action==='list')
      return await premiumList(url,env,fetchFn);
     if(request.method==='POST'&&action==='unlock')
      return await premiumUnlock(request,env,fetchFn);
     throw issue(405,'Unlock premium signals using an authenticated POST request');
    }
    if(url.pathname==='/api/cv-ops'){
     const action=url.searchParams.get('action');
     if(request.method==='GET'&&action==='me'){
      const member=await getMember(request,env,fetchFn);
      const tickets=await memberTickets(fetchFn,secretConfig(env),member.account.uid);
      // Payment collection and historical ledger reads remain unavailable.
      return reply({account:member.account,
       checkout:{enabled:false,priceUSD:20,btcMonthly:null,network:'BTC mainnet',
        wallet:null},
       payments:[],tickets,migration:member.migration});
     }
     if(['messages','new_ticket','reply','close_ticket'].includes(action))
      return await supportRequest(request,action,env,fetchFn,url);
     throw issue(503,'Billing and administrative payment operations are temporarily unavailable');
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
    if(url.pathname==='/api/candles')
     return await getCandles(request,{fetchFn});
    if(url.pathname.startsWith('/api/'))
     throw issue(503,'This API route is not yet migrated');
    if(!env.ASSETS?.fetch)throw issue(503,'Static assets are not configured');
    return env.ASSETS.fetch(request);
   }catch(e){return safeError(e)}
  }
 };
}
export default createWorker();
