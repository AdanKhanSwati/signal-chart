(()=>{'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const page=document.body.dataset.candrivaPage;
const msg=(s,err=false)=>{const el=$('#v2-status');if(!el)return;el.textContent=s;el.classList.toggle('error',err)};
const show=(id,v)=>{const el=$(id);if(el)el.hidden=!v};
const put=(id,v)=>{const el=$(id);if(el)el.textContent=v??'—'};
const clock=s=>s?new Date(s).toLocaleString():'—';
const fmt=(x,d=2)=>Number.isFinite(Number(x))?Number(x).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
let config=null,sb=null,membership=null,selectedPayment=null;
async function sharedSupabaseClient(url,anonKey){
 // Account and trial code run concurrently. Share a single GoTrue client and
 // one script-load Promise so refresh-token storage is never contended locally.
 const slot=window.__scSupabaseAuthClient;
 if(slot){
  if(slot.url!==url||slot.anonKey!==anonKey)throw Error('Authentication project mismatch');
  return await slot.promise;
 }
 const promise=(async()=>{
  if(!window.supabase?.createClient)await new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
   script.async=true;script.crossOrigin='anonymous';
   script.onload=resolve;script.onerror=()=>reject(Error('Unable to load sign-in library'));
   document.head.appendChild(script);
  });
  if(!window.supabase?.createClient)throw Error('Supabase login unavailable');
  return window.supabase.createClient(url,anonKey,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}
  });
 })();
 window.__scSupabaseAuthClient={url,anonKey,promise};
 try{return await promise}
 catch(error){
  if(window.__scSupabaseAuthClient?.promise===promise)delete window.__scSupabaseAuthClient;
  throw error;
 }
}

async function currentToken(){const {data,error}=await sb?.auth?.getSession()||{};if(error||!data?.session?.access_token)throw Error('Supabase session expired. Please sign in again.');return data.session.access_token}
async function request(path,body){const token=await currentToken();const opts=body===undefined?{method:'GET'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
 opts.headers={...opts.headers,Authorization:'Bearer '+token};opts.cache='no-store';opts.credentials='same-origin';
 // Same-origin cookies are required by Vercel protected staging; the Supabase
 // bearer token still independently authenticates and authorizes the user.
 let response;
 // Retry read-only account requests once after a transient mobile-network
 // failure. A write request (payment or admin) is never retried automatically.
 for(let attempt=0;attempt<(body===undefined?2:1);attempt++){
  try{response=await fetch(path,opts);break}
  catch{
   if(body!==undefined||attempt===1)
    throw Error('Network connection to SignalChart was interrupted. Your session was preserved. Retry your account request or sign in again.');
   await new Promise(resolve=>setTimeout(resolve,500));
  }
 }
 const type=response.headers?.get?.('content-type')||'';
 if(type&&!type.includes('application/json'))
  throw Error('Account API returned a webpage instead of JSON. Check access to the protected preview and retry.');
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'Request failed (HTTP '+response.status+')');return data}
const memberAPI=(act,body)=>request('/api/member?action='+encodeURIComponent(act),body);
async function initSupabase(){
 // A transient network failure is not proof that Supabase is unconfigured.
 // Retry only this read-only public configuration request once.
 let response;
 for(let attempt=0;attempt<2;attempt++){
  try{response=await fetch('/api/config',{cache:'no-store',credentials:'same-origin'});break}
  catch(error){if(attempt===1)throw Error('Cannot reach the SignalChart account service. Check your connection and retry.');}
 }
 if(!response.ok)throw Error('SignalChart account service returned HTTP '+response.status+'. Please retry.');
 config=await response.json();
 if(!config.authReady||!config.supabaseUrl||!config.supabaseAnonKey){show('#auth-off',page==='account');if(page==='forex')put('#signals-locked h2','Supabase project connection required');return null}
 sb=await sharedSupabaseClient(config.supabaseUrl,config.supabaseAnonKey);
 return sb;
}
async function signedIn(){if(!sb)return false;const {data,error}=await sb.auth.getSession();if(error)throw error;return !!data?.session?.access_token}

async function fetchMember(){const data=await memberAPI('me');membership=data.account;return data}
function showPopup(kind,a){
 const modal=$('#v2-modal');if(!modal)return;
 const trial=kind==='trial';put('#modal-tag',trial?'WELCOME TO SIGNALCHART':'PREMIUM ACCESS LOCKED');
 put('#modal-title',trial?'Your 72-hour free trial is active!':'Your 72-hour free trial has ended');
 put('#modal-copy',trial?'You have 72 hours to explore live forex research signals, with no payment required.':'Premium forex signals are now locked. Send your cryptocurrency payment and wait for the super-admin approval to unlock 30 days.');
 put('#modal-info',trial?'Trial ends: '+clock(a.trialEndsAt):'Trial expired: '+clock(a.trialEndsAt));
 put('#modal-action',trial?'Explore forex signals →':'Review membership & payment');
 modal.hidden=false;
 const action=$('#modal-action');action.onclick=()=>{modal.hidden=true;if(trial)location.href='/forex.html';else if(page==='forex')location.href='/account.html';else document.querySelector('#checkout-closed')?.scrollIntoView({behavior:'smooth'})};
 const close=$('#modal-close');close.onclick=()=>modal.hidden=true;
}
function setupMemberChrome(){
 if(!sb)return;
 show('#signout',true);
 $('#signout')?.addEventListener('click',async()=>{await sb.auth.signOut();location.href='/account.html'});
 if(membership?.isAdmin)show('#admin-link',true);
}
function startAccount(data){
 const a=data.account,p=data.payment;
 show('#auth-area',false);show('#auth-off',false);show('#member-area',true);
 put('#membership-status',a.status==='trial'?'72-hour free trial':a.status==='active'?'Subscription active':a.status==='granted'?'Complimentary access':a.status==='locked'?'LOCKED':'Administrator');
 put('#membership-caption',a.access?'Access permitted':'Signals locked until approved payment');
 put('#trial-deadline','Ends: '+clock(a.trialEndsAt));put('#paid-deadline',clock(a.accessUntil||a.paidUntil));
 put('#member-email',a.email);put('#member-state',a.status.toUpperCase());put('#trial-expires',clock(a.trialEndsAt));
 put('#membership-copy',a.status==='trial'?'Your 72-hour free access is running. After exactly 72 hours, the server will lock premium signals automatically.':a.status==='active'?'Access renewed for 30 days following independently verified payment approval.':a.status==='granted'?'Complimentary access granted until '+clock(a.manualEndsAt)+'.':a.status==='locked'?(a.trialStatus==='not_activated'?'Confirm your email, then activate your 72-hour, three-signal trial in Account.':a.trialStatus==='exhausted'?'All 3 trial signal unlocks have been used. Upgrade to continue.':a.trialStatus==='expired'?'Your trial has expired. Subscribe to continue.':'Premium signals are locked; free market charts remain available.'):'Admin access is independent of trials.');
 updateClock(a);
 setInterval(async()=>{try{const latest=await fetchMember();startAccountNoInterval(latest);if(a.status==='trial'&&latest.account.status==='locked')showPopup('locked',latest.account)}catch(e){msg(e.message,true)}},30000);
 if(false&&!a.isAdmin&&a.status==='trial'){
  const key='candriva_trial_welcome_'+a.uid;
  if(!localStorage.getItem(key)){localStorage.setItem(key,'1');showPopup('trial',a)}
 } // Verification and expiry use inline status, not an automatic locking popup.
 setupCheckout(data);
}
function updateClock(a){const deadline=a.accessUntil||(a.paidUntil&&Date.parse(a.paidUntil)>Date.now()?a.paidUntil:a.trialEndsAt),ms=Math.max(0,Date.parse(deadline)-Date.now());
 put('#trial-clock',a.status==='trial'?Math.floor(ms/3600000)+'h '+Math.floor(ms%3600000/60000)+'m':a.status==='active'?'Completed':a.status==='granted'?'GRANTED':a.status==='locked'?'EXPIRED':'—')}
function startAccountNoInterval(data){membership=data.account;const a=data.account;put('#membership-status',a.status==='locked'?'LOCKED':a.status==='trial'?'72-hour free trial':a.status==='active'?'Subscription active':a.status==='granted'?'Complimentary access':'Administrator');put('#member-state',a.status.toUpperCase());put('#paid-deadline',clock(a.accessUntil||a.paidUntil));updateClock(a);setupCheckout(data)}
function setupCheckout(data){
 const p=data.payment,a=data.account;
 const enabled=false; // Legacy USDT checkout retired; use verified BTC billing workflow
 show('#checkout',enabled);show('#checkout-closed',!enabled);
 if(enabled){put('#pay-price','$'+fmt(p.priceUSD)+' equivalent USDT');put('#pay-network',p.network);put('#pay-wallet',p.wallet)}
 else{
  const h=$('#checkout-closed h3'),copy=$('#checkout-closed p');
  if(h)h.textContent=a.status==='trial'?'Your trial is active':a.status==='active'?'Your subscription is active':'Bitcoin monthly membership';
  if(copy)copy.textContent=a.status==='trial'?'You do not need to pay during the 72-hour trial. Renewals may be submitted through Membership billing.':a.status==='active'?'Your currently approved subscription remains valid.': 'Manage your Bitcoin monthly invoice and submit transaction evidence through Membership & Billing. Approval requires blockchain confirmation.';
 }
 const list=$('#pay-history');if(list){list.replaceChildren();const requests=data.requests||[];if(!requests.length)list.textContent='No payment requests yet.';for(const row of requests){const div=document.createElement('div');div.className='v2-info';const l=document.createElement('span'),r=document.createElement('strong');l.textContent=clock(row.at)+' · '+row.network;r.textContent=row.decision;div.append(l,r);list.append(div)}}
}
$('#checkout')?.addEventListener('submit',async e=>{
 e.preventDefault();const file=$('#pay-image').files?.[0];if(!file||file.size>1400000||!['image/jpeg','image/png'].includes(file.type))return msg('Please attach a valid screenshot smaller than 1.4 MB.',true);
 const reader=new FileReader(),receipt=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
 if(!confirm('Submit this transaction for independent on-chain verification? Your account will remain locked until approved.'))return;
 try{const data=await fetchMember();const r=await memberAPI('pay',{txid:$('#pay-tx').value.trim(),network:data.payment.network,receipt});msg('Payment submitted. Your account remains locked until admin approval. Reference: '+r.id);$('#checkout').reset();startAccountNoInterval(await fetchMember())}catch(e){msg(e.message,true)}
});
function switchAuth(mode){
 const root=$('#clerk-root');if(!root||!sb)return;root.replaceChildren();
 $$('.v2-tabs button').forEach(btn=>btn.classList.toggle('active',btn.id===(mode==='signup'?'tab-signup':'tab-signin')));
 const form=document.createElement('form');form.className='v2-supabase-form';
 form.innerHTML='<label>Email address<input id="sb-email" type="email" required autocomplete="email" placeholder="name@example.com"></label><label>Password<input id="sb-password" type="password" required minlength="12" autocomplete="'+(mode==='signup'?'new-password':'current-password')+'" placeholder="Minimum 12 characters"></label><button class="v2-primary" type="submit">'+(mode==='signup'?'Create free account':'Sign in securely')+'</button>';
 const note=document.createElement('p');note.className='v2-note';note.textContent=mode==='signup'?'Confirm your email, then activate your one-time 72-hour trial in Account.':'Use your verified Supabase email and password.';form.append(note);
 form.addEventListener('submit',async ev=>{
  ev.preventDefault();const email=form.querySelector('#sb-email').value.trim(),password=form.querySelector('#sb-password').value,submit=form.querySelector('button[type=submit]');submit.disabled=true;msg('');
  try{
   if(mode==='signup'){
     const {data,error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin+'/account.html'}});
     if(error)throw error;
     if(data?.session){const m=await fetchMember();startAccount(m);setupMemberChrome()}else msg('Check your inbox to verify your email, then sign in and activate your 72-hour free trial in Account.');
   }else{
     const {error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;
     const m=await fetchMember();startAccount(m);setupMemberChrome();if(m.account.isAdmin)show('#admin-link',true);
   }
  }catch(error){msg(error.message||'Authentication failed',true)}finally{submit.disabled=false}
 });
 root.append(form);
 if(mode==='signin'){
  const reset=document.createElement('button');reset.type='button';reset.className='v2-outline';reset.textContent='Forgot password?';reset.style.marginTop='12px';
  reset.onclick=async()=>{const email=form.querySelector('#sb-email').value.trim();if(!email)return msg('Enter your email address first.',true);const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/account.html'});msg(error?error.message:'If your account exists, a reset email will arrive.',!!error)};
  root.append(reset);
 }
}
async function initAccount(){
 await initSupabase();if(!sb){msg('Connect SignalChart to a dedicated Supabase project to enable registration.');return}
 const {data}=await sb.auth.getSession();
 if(data?.session?.access_token){const m=await fetchMember();startAccount(m);setupMemberChrome();if(m.account.isAdmin)show('#admin-link',true)}
 else{show('#auth-area',true);const mode=new URL(location.href).searchParams.get('mode')==='signin'?'signin':'signup';switchAuth(mode);$('#tab-signup').onclick=()=>switchAuth('signup');$('#tab-signin').onclick=()=>switchAuth('signin')}
 sb.auth.onAuthStateChange((event)=>{
  // The browser-trial panel shares the same Supabase client. Notify it after
  // this callback returns so it can re-read the newly persisted session.
  if(['SIGNED_IN','SIGNED_OUT','USER_UPDATED'].includes(event))
   setTimeout(()=>window.dispatchEvent(new Event('signalchart:auth-changed')),0);
  if(event!=='PASSWORD_RECOVERY')return;
  show('#auth-area',true);const root=$('#clerk-root');if(!root)return;root.replaceChildren();
  const form=document.createElement('form');form.innerHTML='<label>New password<input id="sb-new-password" type="password" minlength="12" autocomplete="new-password" required></label><button class="v2-primary" type="submit">Save new password</button>';
  form.onsubmit=async ev=>{ev.preventDefault();const {error}=await sb.auth.updateUser({password:$('#sb-new-password').value});msg(error?error.message:'Password updated. You can sign in with the new password.',!!error)};
  root.append(form);
 });
}

async function initForex(){
  $('#reload-forex-history')?.addEventListener('click',loadForexHistory);
 await initSupabase();if(!await signedIn()){show('#signals-locked',true);return}
 const data=await fetchMember();membership=data.account;setupMemberChrome();
 if(!data.account.access){show('#signals-area',false);show('#signals-locked',true);$('#signals-locked h2').textContent='Premium forex details require an active entitlement';$('#signals-locked p').textContent=data.account.trialStatus==='not_activated'?'Confirm your email and activate the 72-hour trial in Account for 3 unique crypto/forex unlocks.':'Your 72-hour trial has expired or its 3-signal allowance was exhausted. You may continue with an approved membership.';$('#signals-locked a').textContent='Review membership and renewal →';showPopup('locked',data.account);return}
 show('#signals-locked',false);show('#signals-area',true);await scanForex();
 $('#scan-again').onclick=scanForex;
 setInterval(async()=>{try{const latest=await fetchMember();if(!latest.account.access){show('#signals-area',false);show('#signals-locked',true);showPopup('locked',latest.account);return}await scanForex()}catch(e){msg(e.message,true)}},60000);
}
function row(label,value){const line=document.createElement('div');line.className='v2-signal-stat';const l=document.createElement('span'),v=document.createElement('b');l.textContent=label;v.textContent=value??'—';line.append(l,v);return line;}
async function loadForexHistory(){
 const root=$('#forex-history');if(!root)return;
 try{const result=await request('/api/forex?action=history');root.replaceChildren();const entries=result.history||[];
  if(!entries.length){root.textContent='No qualified signals have been recorded. The scanner does not force trades.';return}
  for(const s of entries){const rowEl=document.createElement('div');rowEl.className='v2-history-row';
   const title=document.createElement('strong');title.textContent=(s.pair||s.symbol)+' · '+s.direction;
   const details=document.createElement('span');details.textContent=new Date(s.candleTime).toLocaleString()+' · Entry '+s.entry+' · SL '+s.stop+' · TP '+s.target;
   const tag=document.createElement('small');tag.textContent='Paper research / no verified outcome';rowEl.append(title,details,tag);root.append(rowEl)}
 }catch(e){root.textContent='Historical signals unavailable: '+e.message}
}

async function scanForex(){
 try{
  msg('');put('#scan-age','Fetching closed candles…');
  const result=await request('/api/forex');const items=result.items||[];
  put('#scan-age','Updated '+new Date(result.generatedAt).toLocaleTimeString());put('#qualified-count',items.filter(x=>x.status==='QUALIFIED').length);
  const root=$('#forex-cards');root.replaceChildren();
  for(const s of items){const card=document.createElement('article');card.className='v2-panel';const h=document.createElement('h3');h.textContent=s.pair||s.symbol;card.append(h);const badge=document.createElement('span');badge.className='v2-badge'+(s.status==='QUALIFIED'?' qualified':'');badge.textContent=s.status;card.append(badge);
   card.append(row('Direction',s.direction||'NO SIGNAL'),row('Indicative market close',s.lastPrice),row('Entry',s.entry),row('Stop-loss',s.stop),row('Take-profit',s.target),row('RSI 14',s.rsi14),row('Candle timestamp',s.candleTime?clock(s.candleTime):'—'),row('Candle freshness',s.fresh?'Fresh':'Market closed / stale'));
   const reason=document.createElement('p');reason.textContent=s.reason;card.append(reason);const link=document.createElement('a');link.className='v2-outline';link.href='/terminal.html?pair='+encodeURIComponent(s.symbol);link.textContent='View currency chart ↗';card.append(link);root.append(card)
  }
  await loadForexHistory();
 }catch(e){msg(e.message,true);if(/locked|expired/i.test(e.message)){show('#signals-area',false);show('#signals-locked',true)}}
}
async function adminTab(name){
 for(const x of ['overview','members','payments','settings'])show('#admin-'+x,x===name);
 $$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
 try{if(name==='members')await loadMembers();if(name==='payments')await loadPayments();if(name==='settings')await loadSettings()}catch(e){msg(e.message,true)}
}
async function loadDashboard(){const d=await memberAPI('admin_dashboard');const root=$('#admin-kpis');root.replaceChildren();for(const [label,value] of [['Subscribers',d.counts.users],['Trial access',d.counts.trial],['Locked',d.counts.locked],['Active paid',d.counts.active],['Awaiting payment review',d.counts.paymentsPending]]){const c=document.createElement('article');c.className='v2-panel';const small=document.createElement('small');small.textContent=label;const big=document.createElement('strong');big.textContent=value;c.append(small,big);root.append(c)}put('#admin-payment-gate',d.paymentsEnabled?'ENABLED':'DISABLED')}
async function loadMembers(){const d=await memberAPI('admin_users'),root=$('#admin-member-rows');root.replaceChildren();for(const m of d.users||[]){const tr=document.createElement('tr');for(const v of [m.email,m.status,clock(m.trialEndsAt),clock(m.paidUntil)]){const td=document.createElement('td');td.textContent=v;tr.append(td)}root.append(tr)}}
async function loadPayments(){const d=await memberAPI('admin_payments'),root=$('#admin-payment-rows');root.replaceChildren();for(const p of d.payments||[]){const tr=document.createElement('tr');for(const v of [p.email,p.network+' · '+p.txid,'$'+p.amountUSD,p.decision?.decision||'pending']){const td=document.createElement('td');td.textContent=v;tr.append(td)}const td=document.createElement('td');if(!p.decision){const btn=document.createElement('button');btn.className='v2-outline';btn.textContent='Review';btn.onclick=()=>openPayment(p);td.append(btn)}tr.append(td);root.append(tr)}}
function openPayment(p){selectedPayment=p;show('#payment-review',true);put('#review-details',p.email+' · '+p.network+' · tx '+p.txid+' · expected $'+p.amountUSD+' · wallet '+p.recipient);$('#review-confirm').checked=false;$('#review-note').value='';$('#payment-review').scrollIntoView({behavior:'smooth'})}
async function decidePayment(decision){if(!selectedPayment)return;if(decision==='approved'&&!$('#review-confirm').checked)return msg('Independently verify the blockchain transaction before approval.',true);
 if(!confirm(decision==='approved'?'Approve this payment and activate exactly 30 days?':'Reject this payment request?'))return;
 try{await memberAPI('admin_review',{paymentId:selectedPayment.id,decision,confirmedOnChain:$('#review-confirm').checked,note:$('#review-note').value});msg('Payment '+decision+' successfully.');selectedPayment=null;show('#payment-review',false);await loadPayments();await loadDashboard()}catch(e){msg(e.message,true)}
}
async function loadSettings(){const d=await memberAPI('admin_settings'),s=d.settings;$('#bill-price').value=s.priceUSD||'';$('#bill-network').value=s.network||'TRC20';$('#bill-wallet').value=s.wallet||''}
async function initAdmin(){
 await initSupabase();if(!await signedIn()){show('#admin-locked',true);return}
 const data=await fetchMember();setupMemberChrome();
 if(!data.account.isAdmin){show('#admin-locked',true);return}
 show('#admin-area',true);show('#admin-locked',false);await loadDashboard();$$('[data-view]').forEach(btn=>btn.onclick=()=>adminTab(btn.dataset.view));
 $('#admin-reload-members').onclick=loadMembers;$('#admin-reload-payments').onclick=loadPayments;
 $('#review-approve').onclick=()=>decidePayment('approved');$('#review-reject').onclick=()=>decidePayment('rejected');
 $('#review-proof').onclick=async()=>{if(!selectedPayment)return;try{const token=await currentToken(),resp=await fetch('/api/member?action=receipt&id='+selectedPayment.id,{headers:{Authorization:'Bearer '+token}});if(!resp.ok)throw Error('Cannot load private evidence');const blob=await resp.blob(),url=URL.createObjectURL(blob);window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e){msg(e.message,true)}};
 $('#billing-form').onsubmit=async e=>{e.preventDefault();if(!confirm('Save wallet and pricing configuration? Checkout will remain disabled until server activation.'))return;try{await memberAPI('admin_save_settings',{priceUSD:Number($('#bill-price').value),network:$('#bill-network').value,wallet:$('#bill-wallet').value.trim()});msg('Subscription settings stored.');await loadSettings()}catch(err){msg(err.message,true)}};
}
async function boot(){
 try{if(page==='account')await initAccount();else if(page==='forex')await initForex();else if(page==='admin')await initAdmin()}
 catch(e){
  msg(e.message||'Account could not be loaded.',true);
  // Do not falsely claim the Supabase project is missing after a network,
  // protected-preview or member-API failure.
  if(page==='account'){
   show('#auth-off',false);
   // An unavailable membership endpoint is not a reason to hide sign-in.
   // Do not clear a stored session without an explicit user action.
   if(sb){
    show('#auth-area',true);
    switchAuth('signin');
    $('#tab-signup').onclick=()=>switchAuth('signup');
    $('#tab-signin').onclick=()=>switchAuth('signin');
   }
   const status=$('#v2-status');
   if(status){
    const note=document.createElement('p');
    note.textContent='Your sign-in may still be valid. Account details did not load; no trial or payment was changed.';
    const retry=document.createElement('button');
    retry.type='button';retry.className='v2-outline';retry.textContent='Retry account connection';
    retry.onclick=async()=>{
     retry.disabled=true;msg('Checking your account connection…');
     try{const data=await fetchMember();startAccount(data);setupMemberChrome();msg('')}
     catch(err){msg(err.message||'Account is still unavailable.',true)}
     finally{retry.disabled=false}
    };
    status.append(note,retry);
    if(sb){
     const signout=document.createElement('button');
     signout.type='button';signout.className='v2-outline';
     signout.textContent='Sign out and use another account';
     signout.onclick=async()=>{
      signout.disabled=true;
      try{await sb.auth.signOut();location.assign('/account.html?mode=signin')}
      catch(err){msg(err.message||'Sign-out could not be completed.',true);signout.disabled=false}
     };
     status.append(signout);
    }
   }
  }
  if(page==='admin')show('#admin-locked',true);
 }
}
boot();
})();