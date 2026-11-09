'use strict';
/** SignalChart verified-phone trial gateway.
 * Privileged Supabase RPCs are server-only and fail closed if not configured.
 * Existing customer Supabase sessions remain the only identity authority. */
const {createHmac}=require('node:crypto');
const E164=/^\+[1-9]\d{7,14}$/;
const SIGNAL_KEY=/^[a-zA-Z0-9][a-zA-Z0-9:_.-]{2,139}$/;
const PHONE_REUSED='This number has already been used for a free trial. You can continue with a paid membership.';
function issue(status,message){return Object.assign(new Error(message),{status})}
function e164(value){
 if(typeof value!=='string'||!E164.test(value.trim()))throw issue(400,'Enter a valid international number, for example +923001234567.');
 return value.trim();
}
function createTrialGateway(core,{fetchFn=globalThis.fetch,clock=()=>Date.now(),env=process.env}={}){
 function getConfig(){
  const config=core.authConfig();
  if(!config.ready)throw issue(503,'Supabase authentication is not configured');
  return config;
 }
 function privileged(){
  // Supabase supports modern server-only secret API keys and older service-role JWTs.
  // The new sb_secret key is not a JWT; send it ONLY as an apikey header.
  const secret=String(env.SUPABASE_SECRET_KEY||'');
  const legacy=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
  if(/^sb_secret_[a-zA-Z0-9_-]{20,}$/.test(secret))
   return {key:secret,legacy:false};
  if(/^eyJ[a-zA-Z0-9._-]{80,}$/.test(legacy))
   return {key:legacy,legacy:true};
  throw issue(503,'Server-side trial database connection is not configured');
 }
 function fingerprint(value){
  const secret=String(env.SC_TRIAL_HMAC_SECRET||'');
  if(secret.length<32)throw issue(503,'Trial identity protection is not configured');
  return createHmac('sha256',secret).update(value).digest('hex');
 }
 async function rpc(name,params){
  if(!/^sc_[a-z0-9_]+$/.test(name))throw issue(500,'Invalid trial database operation');
  const config=getConfig(),service=privileged();
  const headers={apikey:service.key,'Content-Type':'application/json'};
  if(service.legacy)headers.Authorization='Bearer '+service.key;
  let r;
  try{r=await fetchFn(config.url+'/rest/v1/rpc/'+name,{
   method:'POST',headers,
   body:JSON.stringify(params),signal:AbortSignal.timeout(12000),cache:'no-store'})}
  catch{throw issue(503,'Trial service temporarily unavailable')}
  if(!r.ok){
   if(r.status===404||r.status===401||r.status===403)throw issue(503,'Trial database migration or permissions are not ready');
   const body=await r.json().catch(()=>({}));
   if(r.status===409||body.code==='23505')throw issue(409,'This trial action has already been completed');
   if(r.status===400||body.code==='22023')throw issue(400,'Invalid trial request');
   throw issue(503,'Trial database operation unavailable');
  }
  return await r.json();
 }
 async function userFromToken(token){
  const config=getConfig();
  let response;
  try{response=await fetchFn(config.url+'/auth/v1/user',{
   headers:{apikey:config.key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000),cache:'no-store'})}
  catch{throw issue(503,'Phone verification provider unavailable')}
  if(!response.ok)throw issue(401,'Sign in again to verify your number');
  const user=await response.json();
  if(!/^[0-9a-f-]{36}$/i.test(String(user?.id||'')))throw issue(401,'Invalid session');
  return user;
 }
 function bearer(req){
  const match=/^Bearer ([-\w.+~/=]+)$/.exec(String(req.headers?.authorization||''));
  if(!match)throw issue(401,'Sign in required');
  return match[1];
 }
 function netHash(req){
  // Advisory risk-only signal. Shared IPs and VPNs must never be sole grounds for denial.
  const ip=String(req.headers?.['x-vercel-forwarded-for']||req.headers?.['x-real-ip']||req.socket?.remoteAddress||'');
  return ip&&ip.length<=120?fingerprint('net:'+ip):null;
 }
 function deviceHash(req){
  const device=String(req.headers?.['x-sc-device-hint']||'');
  return /^[a-zA-Z0-9_-]{16,90}$/.test(device)?fingerprint('device:'+device):null;
 }
 async function verifySignedIn(req){
  const token=bearer(req),user=await userFromToken(token);
  if(!user.email||!user.email_confirmed_at)throw issue(403,'Verify your email first');
  return {token,uid:user.id.toLowerCase(),user};
 }
 async function state(uid){
  const state=await rpc('sc_trial_state',{p_user:uid});
  return {...state,serverNow:new Date(clock()).toISOString()};
 }
 async function enforceLegacyEligibility(user,phone){
  const rollout=Date.parse(String(env.SC_TRIAL_ROLLOUT_AT||''));
  const created=Date.parse(String(user.created_at||''));
  if(!Number.isFinite(rollout)||!Number.isFinite(created))
   throw issue(503,'Historical account eligibility checks are not configured');
  // Never start another trial for an existing UID; DB check is authoritative.
  const current=await rpc('sc_trial_state',{p_user:user.id.toLowerCase()});
  if(current.trialStatus!=='not_activated'){
   throw issue(409,'A free trial has already been recorded for this account. You can subscribe to continue.');
  }
  const legacy=typeof core.findMemberRecord==='function'
   ?await core.findMemberRecord(user.id.toLowerCase()):null;
  const historical=created<rollout||!!legacy?.trialStartedAt;
  if(historical){
   const allowed=await rpc('sc_can_override_legacy_trial',{
     p_user:user.id.toLowerCase(),p_phone_hash:fingerprint('phone:'+phone)});
   if(allowed!==true)throw issue(409,
    'This account has earlier trial history. You can continue with a paid membership or request a free-trial eligibility review.');
  }
 }
 async function otpStart(req,phoneInput){
  const {token,uid}=await verifySignedIn(req);
  const phone=e164(phoneInput),phoneHash=fingerprint('phone:'+phone);
  await enforceLegacyEligibility((await userFromToken(token)),phone);
  const check=await rpc('sc_otp_rate_check',{
   p_user:uid,p_phone_hash:phoneHash,p_network_hash:netHash(req),
   p_device_hash:deviceHash(req),p_kind:'request'});
  if(!check.allowed)throw issue(429,'Too many verification requests. Try again after the cooldown.');
  const c=getConfig();
  let sent;
  try{sent=await fetchFn(c.url+'/auth/v1/user',{
   method:'PUT',headers:{apikey:c.key,Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({phone}),signal:AbortSignal.timeout(10000),cache:'no-store'})}
  catch{throw issue(503,'SMS verification unavailable. No trial has been activated.')}
  if(!sent.ok)throw issue(sent.status===429?429:503,
   sent.status===429?'SMS rate limit reached. Please try again later.':'SMS provider is unavailable or the number cannot be verified.');
  return {status:'otp_sent',cooldownSeconds:60};
 }
 async function otpVerify(req,phoneInput,code){
  const {token,uid}=await verifySignedIn(req),phone=e164(phoneInput);
  const phoneHash=fingerprint('phone:'+phone);
  await enforceLegacyEligibility((await userFromToken(token)),phone);
  if(typeof code!=='string'||!/^\d{6,8}$/.test(code.trim()))throw issue(400,'Enter the OTP code from your SMS');
  const guard=await rpc('sc_otp_rate_check',{p_user:uid,p_phone_hash:phoneHash,
   p_network_hash:netHash(req),p_device_hash:deviceHash(req),p_kind:'verify_check'});
  if(!guard.allowed)throw issue(429,'Too many invalid verification attempts. Please try again later.');
  const c=getConfig();
  let response;
  try{response=await fetchFn(c.url+'/auth/v1/verify',{
   method:'POST',
   headers:{apikey:c.key,Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({type:'phone_change',phone,token:code.trim()}),
   signal:AbortSignal.timeout(10000),cache:'no-store'})}
  catch{throw issue(503,'OTP verification unavailable')}
  if(!response.ok){
   await rpc('sc_otp_rate_check',{p_user:uid,p_phone_hash:phoneHash,
    p_network_hash:netHash(req),p_device_hash:deviceHash(req),p_kind:'failed'});
   throw issue(response.status===429?429:400,'The code is invalid, expired or rate-limited');
  }
  const result=await response.json().catch(()=>({}));
  // Supabase may issue a refreshed session on phone_change. Never trust body alone.
  const freshToken=String(result.access_token||result.session?.access_token||token);
  const confirmed=await userFromToken(freshToken);
  if(confirmed.id.toLowerCase()!==uid||confirmed.phone!==phone||!confirmed.phone_confirmed_at)
    throw issue(409,'Phone verification is not confirmed yet. Refresh your session and retry.');
  const verifiedAt=Date.parse(confirmed.phone_confirmed_at);
  if(!Number.isFinite(verifiedAt)||verifiedAt>clock()+120000)
    throw issue(409,'Phone verification cannot be confirmed');
  await rpc('sc_otp_rate_check',{p_user:uid,p_phone_hash:phoneHash,
   p_network_hash:netHash(req),p_device_hash:deviceHash(req),p_kind:'verified'});
  const trial=await rpc('sc_activate_trial',{
   p_user:uid,p_phone_hash:phoneHash,p_phone_verified_at:confirmed.phone_confirmed_at});
  return {status:trial.result,trial:trial.trial||null,message:trial.result==='already_used'?PHONE_REUSED:trial.result==='legacy_review_required'?'Existing trial history requires administrator review. Your account can still be used with paid membership.':null};
 }
 async function activateExistingVerifiedPhone(req){
  const {uid,user}=await verifySignedIn(req);
  if(!E164.test(String(user.phone||''))||!user.phone_confirmed_at)
    throw issue(403,'Verify your mobile number before activating a free trial');
  await enforceLegacyEligibility(user,user.phone);
  const trial=await rpc('sc_activate_trial',{p_user:uid,p_phone_hash:fingerprint('phone:'+user.phone),
    p_phone_verified_at:user.phone_confirmed_at});
  return {status:trial.result,trial:trial.trial||null,message:trial.result==='already_used'?PHONE_REUSED:trial.result==='legacy_review_required'?'Existing trial history requires administrator review. Your account can still be used with paid membership.':null};
 }
 async function listSignals(market){
  return await rpc('sc_signal_public_list',{p_market:market||null,p_limit:50});
 }
 async function premiumUnlock(uid,signalKey,paidEntitlement=false){
  if(typeof signalKey!=='string'||!SIGNAL_KEY.test(signalKey))
   throw issue(400,'Invalid premium signal reference');
  // A paid or administrator entitlement bypasses trial credits, but not the
  // authorization performed by the calling API BEFORE invoking this method.
  if(paidEntitlement){
   const detail=await rpc('sc_signal_detail_server',{p_signal_key:signalKey});
   return detail?.found
     ?{allowed:true,reason:'membership',signal:detail.data,signalKey}
     :{allowed:false,reason:'not_found'};
  }
  const result=await rpc('sc_unlock_trial',{p_user:uid,p_signal_key:signalKey});
  return {allowed:result.allowed===true,reason:result.reason||'denied',
   signal:result.allowed?result.data:null,signalKey,
   signalsUsed:result.signalsUsed??null,signalsRemaining:result.signalsRemaining??null,
   trialExhausted:result.trialExhausted===true};
 }
 async function admin(action,actor,body={}){
  const fields={p_actor:actor.uid,p_action:action,p_user:body.userId,
   p_phone_hash:body.phoneHash||null,p_reason:body.reason||'',p_valid_until:body.validUntil||null};
  return await rpc('sc_admin_trial_action',fields);
 }
 return {state,rpc,e164,hashPhone:phone=>fingerprint('phone:'+e164(phone)),otpStart,otpVerify,activateExistingVerifiedPhone,
   listSignals,premiumUnlock,admin,verifySignedIn,PHONE_REUSED};
}
module.exports={createTrialGateway,e164,PHONE_REUSED};
