(()=>{'use strict';
/** Small, design-neutral wrapper around the authoritative trial APIs.
 * No localStorage values control entitlements; counts and times are server-issued. */
const $=s=>document.querySelector(s),create=(tag,cls,text)=>{
 const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n};
const accountRoot=$('#sc-trial-account'),signalsRoot=$('#sc-trial-signals');
if(!accountRoot&&!signalsRoot)return;
let auth=null,session=null,trial=null,serverOffset=0,selectedMarket='all',allSignals=[];
let paidOverride=null,browserTrialEnabled=false,turnstileSiteKey=null,turnstileWidget=null,turnstileLoading=false;
const notify=(text,bad=false)=>{
 const node=$('#sc-trial-feedback');if(!node)return;
 node.textContent=String(text||'');node.dataset.error=bad?'true':'false'};
const safeTime=s=>s?new Date(s).toLocaleString():'—';
function updateVerificationGuide(signedIn){
 const ready=browserTrialEnabled&&!!turnstileSiteKey;
 const state=$('#sc-browser-availability');
 if(state){state.textContent=ready?'Browser trial activation available':'Browser trial setup pending';state.dataset.available=ready?'true':'false'}
 const link=$('#sc-browser-guide-link');
 if(link){link.href=signedIn?'#sc-browser-activation':'#auth-area';link.textContent=signedIn?'Activate free trial':'Sign in to continue'}
 const small=$('#sc-signal-browser-status');
 if(small)small.textContent=ready?'Verified email and browser anti-bot verification required':'Free trial activation is being configured';
 const note=$('#sc-browser-delivery-note');
 if(note)note.textContent=ready?'Complete the anti-bot check, then activate your 72-hour trial. No phone needed.':'Browser trial activation will become available after anti-bot setup. No trial has started.';
 const btn=$('#sc-activate-browser');if(btn)btn.disabled=!ready;
}

const expString=()=>{
 if(!trial?.expiresAt)return 'Not activated';
 const ms=Math.max(0,Date.parse(trial.expiresAt)-(Date.now()+serverOffset));
 const days=Math.floor(ms/86400000),hours=Math.floor(ms%86400000/3600000),mins=Math.floor(ms%3600000/60000);
 return days+'d '+hours+'h '+mins+'m';
};
async function initializeClient(){
 const c=await fetch('/api/config',{cache:'no-store'}).then(x=>x.ok?x.json():Promise.reject(Error('Authentication unavailable')));
 if(!c.authReady||!c.supabaseUrl||!c.supabaseAnonKey)throw Error('Sign-in service unavailable');
 browserTrialEnabled=c.emailDeviceTrialEnabled===true&&c.trialVerificationMethod==='verified_email_browser';
 turnstileSiteKey=typeof c.turnstileSiteKey==='string'?c.turnstileSiteKey:null;
 updateVerificationGuide(false);
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
  cache:'no-store',credentials:'same-origin'});
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
 const active=trial.trialStatus==='active',termOpen=active||trial.trialStatus==='exhausted',count=Math.max(0,Math.min(3,Number(trial.signalsUsed)||0));
 const remaining=Math.max(0,Math.min(3,Number(trial.signalsRemaining)||0));
 const label=$('#sc-trial-state'),clock=$('#sc-trial-clock'),counter=$('#sc-trial-credits'),bar=$('#sc-trial-progress');
 if(label)label.textContent=paidOverride?'Active paid / complimentary access':trial.trialStatus==='not_activated'?'Activate your verified-email free trial':
   active?'Free trial active':trial.trialStatus==='exhausted'?'3/3 unlocked · Reopen until expiry':
   trial.trialStatus==='expired'?'Free trial expired':trial.trialStatus==='revoked'?'Trial unavailable':'Trial pending';
 if(clock)clock.textContent=paidOverride?paidOverride.accessUntil?safeTime(paidOverride.accessUntil):'Authorized':termOpen?expString():trial.expiresAt?safeTime(trial.expiresAt):'Not started';
 if(counter)counter.textContent=paidOverride?'Membership access':remaining+' of 3 remaining';
 if(bar){bar.max=3;bar.value=count}
 const activation=$('#sc-browser-activation');
 if(activation)activation.hidden=!!paidOverride||trial.trialStatus!=='not_activated';
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
 paintStatus();updateVerificationGuide(true);
 await renderTurnstile();return value;
}
async function renderTurnstile(){
 // Cloudflare's iframe must be rendered into a visible container. Rendering
 // while #member-area is hidden produces an unusable/zero-width challenge.
 const panel=$('#sc-browser-activation'),member=$('#member-area');
 if(!accountRoot||!browserTrialEnabled||!turnstileSiteKey||!panel||
    panel.hidden||member?.hidden||turnstileWidget!==null||turnstileLoading)return;
 turnstileLoading=true;
 try{
  if(!window.turnstile?.render)await new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
   script.async=true;script.onload=resolve;
   script.onerror=()=>reject(Error('Unable to load the verification challenge'));
   document.head.append(script);
  });
  // Auth may have changed while the provider script was loading.
  if(panel.hidden||member?.hidden)return;
  const node=$('#sc-turnstile');
  if(node&&window.turnstile?.render)
   turnstileWidget=window.turnstile.render(node,{
    sitekey:turnstileSiteKey,theme:'auto',action:'trial_activate'
   });
 }catch(e){notify(e.message||'Unable to load anti-bot verification',true)}
 finally{turnstileLoading=false}
}
async function activateBrowser(){
 const button=$('#sc-activate-browser');
 if(!button||button.disabled||!browserTrialEnabled)return;
 button.disabled=true;
 try{
  const challenge=turnstileWidget!==null&&window.turnstile?.getResponse?
   window.turnstile.getResponse(turnstileWidget):'';
  if(!challenge)throw Error('Complete the anti-bot verification first');
  await api('device',undefined,'GET'); // Backend issues secure HttpOnly cookie.
  const result=await api('activate_browser',{turnstileToken:challenge});
  if(result.status==='activated')notify('Trial activated: 72 hours and 3 unique signal unlocks.');
  else if(result.status==='device_already_used')notify(result.message||'This browser already claimed a trial. Sign in to your original account.',true);
  else if(result.status==='rate_limited')notify('Too many trial attempts. Try again later.',true);
  else notify(result.message||'Trial eligibility has been checked.',result.status!=='existing_trial');
  await refresh();
 }catch(e){notify(e.message,true)}
 finally{
  if(turnstileWidget!==null&&window.turnstile?.reset)window.turnstile.reset(turnstileWidget);
  button.disabled=!(browserTrialEnabled&&!!turnstileSiteKey);
 }
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
    button.textContent=data.trialExhausted?'Unlocked · 3/3 used':'Unlocked';
    notify(data.trialExhausted?'All 3 trial slots used. You can reopen these three signals until expiry.':'Signal unlocked.');
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
  updateVerificationGuide(!!t);
  if(accountRoot){
   $('#sc-activate-browser')?.addEventListener('click',activateBrowser);
   // The parent member panel is revealed by the main auth UI asynchronously.
   // Observe both hidden attributes and render only after the pane is visible.
   const observer=new MutationObserver(()=>{renderTurnstile().catch(e=>notify(e.message,true))});
   for(const node of [$('#member-area'),$('#sc-browser-activation')]){
    if(node)observer.observe(node,{attributes:true,attributeFilter:['hidden']});
   }
  }
  if(signalsRoot){
   document.querySelectorAll('[data-sc-trial-market]').forEach(btn=>btn.onclick=()=>{
    selectedMarket=btn.dataset.scTrialMarket;drawSignals()});
   await loadSignals();
  }
  if(t){await refresh()}
  else{
   if($('#sc-trial-state'))$('#sc-trial-state').textContent='Sign in to check trial status';
   const activation=$('#sc-browser-activation');if(activation)activation.hidden=true;
  }

 }catch(e){notify(e.message,true);updateVerificationGuide(!!session)}
}
setInterval(()=>{if(trial)paintStatus()},1000);
window.addEventListener('signalchart:auth-changed',()=>{
 token().then(async t=>{
  updateVerificationGuide(!!t);
  if(t){await refresh()}
  else{
   trial=null;paidOverride=null;
   const activation=$('#sc-browser-activation');if(activation)activation.hidden=true;
   const state=$('#sc-trial-state');if(state)state.textContent='Sign in to check trial status';
  }
 }).catch(e=>notify(e.message,true));
});
window.addEventListener('focus',()=>{token().then(t=>t&&refresh()).catch(()=>{})});
boot();
})();