(()=>{'use strict';
/** Small, design-neutral wrapper around the authoritative trial APIs.
 * No localStorage values control entitlements; counts and times are server-issued. */
const $=s=>document.querySelector(s),create=(tag,cls,text)=>{
 const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n};
const accountRoot=$('#sc-trial-account'),signalsRoot=$('#sc-trial-signals');
if(!accountRoot&&!signalsRoot)return;
let auth=null,session=null,trial=null,serverOffset=0,selectedMarket='all',allSignals=[];
let resendUntil=0,paidOverride=null,phoneDeliveryEnabled=false;
const notify=(text,bad=false)=>{
 const node=$('#sc-trial-feedback');if(!node)return;
 node.textContent=String(text||'');node.dataset.error=bad?'true':'false'};
const safeTime=s=>s?new Date(s).toLocaleString():'—';
const expString=()=>{
 if(!trial?.expiresAt)return 'Not activated';
 const ms=Math.max(0,Date.parse(trial.expiresAt)-(Date.now()+serverOffset));
 const days=Math.floor(ms/86400000),hours=Math.floor(ms%86400000/3600000),mins=Math.floor(ms%3600000/60000);
 return days+'d '+hours+'h '+mins+'m';
};
async function initializeClient(){
 const c=await fetch('/api/config',{cache:'no-store'}).then(x=>x.ok?x.json():Promise.reject(Error('Authentication unavailable')));
 if(!c.authReady||!c.supabaseUrl||!c.supabaseAnonKey)throw Error('Sign-in service unavailable');
 phoneDeliveryEnabled=c.phoneVerificationEnabled===true&&c.phoneVerificationChannel==='whatsapp';
 if(!window.supabase?.createClient)await new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  script.onload=resolve;script.onerror=()=>reject(Error('Unable to load sign-in library'));document.head.append(script)});
 auth=window.supabase.createClient(c.supabaseUrl,c.supabaseAnonKey,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
}
async function token(){
 if(!auth)return null;
 const {data,error}=await auth.auth.getSession();
 if(error)throw Error('Please sign in again');
 session=data?.session||null;return session?.access_token||null;
}
async function api(action,body,method='POST'){
 const t=await token();if(!t)throw Error('Sign in to your SignalChart account');
 const response=await fetch('/api/trial?action='+encodeURIComponent(action),{
  method,headers:{Authorization:'Bearer '+t,...(method==='POST'?{'Content-Type':'application/json'}:{})},
  body:method==='POST'?JSON.stringify(body||{}):undefined,
  cache:'no-store',credentials:'omit'});
 const value=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(value.error||'Unable to verify trial status');
 return value;
}
async function unlock(signalKey){
 const t=await token();if(!t)throw Error('Sign in before unlocking a signal');
 const response=await fetch('/api/premium-signals?action=unlock',{
  method:'POST',cache:'no-store',credentials:'omit',
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},
  body:JSON.stringify({signalKey})});
 const value=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(value.error||'This signal requires an upgrade');
 return value;
}
function paintStatus(){
 if(!trial)return;
 const active=trial.trialStatus==='active',count=Math.max(0,Math.min(3,Number(trial.signalsUsed)||0));
 const remaining=Math.max(0,Math.min(3,Number(trial.signalsRemaining)||0));
 const label=$('#sc-trial-state'),clock=$('#sc-trial-clock'),counter=$('#sc-trial-credits'),bar=$('#sc-trial-progress');
 if(label)label.textContent=paidOverride?'Active paid / complimentary access':trial.trialStatus==='not_activated'?'Phone verification required':
   active?'Free trial active':trial.trialStatus==='exhausted'?'3 signals used · Upgrade':
   trial.trialStatus==='expired'?'Free trial expired':trial.trialStatus==='revoked'?'Trial unavailable':'Trial pending';
 if(clock)clock.textContent=paidOverride?paidOverride.accessUntil?safeTime(paidOverride.accessUntil):'Authorized':active?expString():trial.expiresAt?safeTime(trial.expiresAt):'Not started';
 if(counter)counter.textContent=paidOverride?'Membership access':remaining+' of 3 remaining';
 if(bar){bar.max=3;bar.value=count}
 const phone=$('#sc-phone-verification');
 if(phone)phone.hidden=!!paidOverride||trial.trialStatus!=='not_activated';
 const upgrade=$('#sc-trial-upgrade');if(upgrade)upgrade.hidden=active||!!paidOverride;
}
async function refresh(){
 const value=await api('state',undefined,'GET');
 trial=value;serverOffset=Date.parse(trial.serverNow)-Date.now();
 try{
  const t=await token();
  const r=await fetch('/api/member?action=me',{headers:{Authorization:'Bearer '+t},cache:'no-store'});
  if(r.ok){
   const account=(await r.json()).account;
   paidOverride=['active','granted','administrator'].includes(account?.status)?account:null;
  }else paidOverride=null;
 }catch{paidOverride=null}
 paintStatus();return value;
}
function riskHint(){
 // Random pseudonymous session indicator, not a hardware fingerprint or identity.
 const k='sc_trial_device_hint_v1';
 let id;try{id=localStorage.getItem(k)}catch{}
 if(!id&&window.crypto?.getRandomValues){
  const bytes=new Uint8Array(24);window.crypto.getRandomValues(bytes);
  id=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
  try{localStorage.setItem(k,id)}catch{}}
 return id||'';
}
async function startOTP(e){
 e.preventDefault();const phone=$('#sc-phone')?.value.trim()||'';
 if(!phoneDeliveryEnabled){notify('WhatsApp verification is not configured yet. No message has been sent.',true);return}
 if(Date.now()<resendUntil)return;
 const btn=$('#sc-send-otp');btn.disabled=true;
 try{
  if(!/^\+[1-9]\d{7,14}$/.test(phone))throw Error('Enter an international mobile number, such as +923001234567.');
  const t=await token();if(!t)throw Error('Sign in first');
  const response=await fetch('/api/trial?action=otp_start',{
   method:'POST',cache:'no-store',
   headers:{Authorization:'Bearer '+t,'Content-Type':'application/json','X-SC-Device-Hint':riskHint()},
   body:JSON.stringify({phone})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(payload.error||'WhatsApp verification request failed');
  resendUntil=Date.now()+60000;
  const otp=$('#sc-otp-form');otp.hidden=false;
  notify('WhatsApp verification requested. Enter the code from WhatsApp to activate your trial.');
 }catch(err){notify(err.message,true)}finally{
  btn.disabled=false;updateResend();
 }
}
function updateResend(){
 const btn=$('#sc-send-otp');if(!btn)return;
 const s=Math.ceil((resendUntil-Date.now())/1000);
 if(s>0){btn.disabled=true;btn.textContent='Resend in '+s+'s'}
 else{btn.disabled=!phoneDeliveryEnabled;btn.textContent=phoneDeliveryEnabled?'Send WhatsApp code':'WhatsApp verification unavailable'}
}
async function verifyOTP(e){
 e.preventDefault();const btn=$('#sc-confirm-otp');btn.disabled=true;
 try{
  const result=await api('otp_verify',{phone:$('#sc-phone').value.trim(),code:$('#sc-otp').value.trim()});
  if(result.status==='already_used'){
   notify(result.message||'This number has already been used for a free trial. You can continue with a paid membership.',true);
  }else{
   notify('Phone verified. Your 72-hour trial is active, with 3 premium signal unlocks.');
   await refresh();
  }
 }catch(err){notify(err.message,true)}finally{btn.disabled=false}
}
async function activateExisting(){
 const btn=$('#sc-existing-phone');if(btn)btn.disabled=true;
 try{const result=await api('activate_existing_phone',{});
  notify(result.message||'Your verified phone status has been checked.',result.status==='already_used');
  await refresh();
 }catch(e){notify(e.message,true)}finally{if(btn)btn.disabled=false}
}
function renderSignalData(root,signal){
 root.replaceChildren();
 const entries=['direction','entry','entryZone','stopLoss','takeProfit','target','explanation','rationale'];
 let shown=0;
 for(const key of entries)if(Object.prototype.hasOwnProperty.call(signal||{},key)){
  const value=signal[key];if(value===undefined||value===null)continue;
  const line=create('div','sc-trial-detail-line');
  const title=create('small','',key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()));
  const val=create('strong','',typeof value==='object'?JSON.stringify(value):String(value));
  line.append(title,val);root.append(line);shown++;
 }
 if(!shown)root.append(create('p','', 'Premium signal unlocked. No actionable fields are currently published.'));
}
function drawSignals(){
 const root=$('#sc-premium-list');if(!root)return;
 root.replaceChildren();
 const rows=allSignals.filter(x=>selectedMarket==='all'||x.market===selectedMarket);
 if(!rows.length){root.append(create('p','sc-trial-hint','No verified premium signals are currently published for this market.'));return}
 for(const signal of rows){
  const card=create('article','sc-trial-signal');
  const top=create('div','sc-trial-signal-top');
  top.append(create('strong','',signal.asset),create('span','',signal.market.toUpperCase()));
  const hint=create('p','',new Date(signal.publishedAt).toLocaleDateString()+' · Premium details are private until unlocked.');
  const button=create('button','sc-trial-button','Unlock premium signal');
  button.type='button';
  const result=create('div','sc-trial-result');
  button.onclick=async()=>{
   button.disabled=true;result.textContent='Checking entitlement…';
   try{
    const data=await unlock(signal.signalKey);
    result.replaceChildren();renderSignalData(result,data.signal);
    button.textContent=data.signalsRemaining===0?'Trial allowance consumed':'Unlocked';
    notify(data.trialExhausted?'You used all 3 premium trial unlocks. Upgrade to continue.':'Signal unlocked.');
    await refresh();
   }catch(e){result.textContent=e.message;notify(e.message,true)}
   finally{button.disabled=false}
  };
  card.append(top,hint,button,result);root.append(card);
 }
}
async function loadSignals(){
 const root=$('#sc-premium-list');if(!root)return;
 const response=await fetch('/api/premium-signals?action=list',{cache:'no-store'});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'Signal feed unavailable');
 allSignals=Array.isArray(result.signals)?result.signals:[];
 drawSignals();
}
async function boot(){
 try{
  for(const link of document.querySelectorAll('#sc-trial-upgrade')){
   link.addEventListener('click',async e=>{
    e.preventDefault();const url=link.href;
    try{await Promise.race([api('upgrade_click',{}),new Promise(resolve=>setTimeout(resolve,450))])}
    catch{}
    location.assign(url);
   });
  }
  await initializeClient();
  const t=await token();
  if(accountRoot){
   $('#sc-phone-form')?.addEventListener('submit',startOTP);
   if(!phoneDeliveryEnabled){
    const send=$('#sc-send-otp');if(send){send.disabled=true;send.textContent='WhatsApp verification unavailable'}
    const status=$('#sc-otp-delivery-note');if(status)status.textContent='WhatsApp verification will be enabled after provider setup. No message is sent during development.';
   }
   $('#sc-otp-form')?.addEventListener('submit',verifyOTP);
   $('#sc-existing-phone')?.addEventListener('click',activateExisting);
  }
  if(signalsRoot){
   document.querySelectorAll('[data-sc-trial-market]').forEach(btn=>btn.onclick=()=>{
    selectedMarket=btn.dataset.scTrialMarket;drawSignals()});
   await loadSignals();
  }
  if(t){await refresh()}
  else{
   if($('#sc-trial-state'))$('#sc-trial-state').textContent='Sign in to check trial status';
   const phone=$('#sc-phone-verification');if(phone)phone.hidden=true;
  }
  if(t)await activateKnownVerifiedPhoneHint();
 }catch(e){notify(e.message,true)}
}
async function activateKnownVerifiedPhoneHint(){
 // Show optional no-SMS activation if Supabase already confirmed an account phone.
 if(!auth||!trial||trial.trialStatus!=='not_activated')return;
 const user=(await auth.auth.getUser()).data?.user;
 if(user?.phone&&user.phone_confirmed_at){
  const b=$('#sc-existing-phone');if(b)b.hidden=false;
 }
}
setInterval(()=>{if(trial)paintStatus();updateResend()},1000);
window.addEventListener('focus',()=>{token().then(t=>t&&refresh()).catch(()=>{})});
boot();
})();