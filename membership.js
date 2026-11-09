(()=>{
'use strict';
const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>s&&Number.isFinite(Date.parse(s))?new Date(s).toLocaleString():'—';
const signalsAPI=async(action,body)=>{const r=await fetch("/api/signals?action="+encodeURIComponent(action),body===undefined?{credentials:"include",cache:"no-store"}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),credentials:"include"});let result={};try{result=await r.json()}catch{}if(!r.ok)throw Error(result.error||("Signals request failed "+r.status));return result};
const api=async(action,body)=>{
 const url='/api/candriva?action='+encodeURIComponent(action);
 const opts=body===undefined?{method:'GET',credentials:'include',cache:'no-store'}:{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'};
 const r=await fetch(url,opts);let payload={};try{payload=await r.json()}catch{};
 if(!r.ok)throw Error(payload.error||('Request failed (HTTP '+r.status+')'));return payload;
};
const say=(msg,error=false)=>{const target=$('#admin-msg')||$('#members-msg');if(!target)return;target.textContent=msg;target.classList.toggle('error',error);if(msg)target.scrollIntoView({behavior:'smooth',block:'nearest'});};
const toggle=(node,on)=>{if(node)node.hidden=!on};
const text=(sel,v)=>{const el=$(sel);if(el)el.textContent=v??'—'};
const showLoading=async(btn,task)=>{if(btn){btn.disabled=true;btn.dataset.old=btn.textContent;btn.textContent='Processing…'}try{return await task()}finally{if(btn){btn.disabled=false;btn.textContent=btn.dataset.old||'Submit'}}};
const subscriptionReadable=s=>({'pending_verification':'Pending review',trial:'Free trial',active:'Active subscription',expired:'Expired',suspended:'Suspended'}[s]||s||'—');
const remaining=to=>{if(!to)return 'Not started';const millis=Date.parse(to)-Date.now();if(millis<=0)return 'Expired';const h=Math.floor(millis/3600000),m=Math.floor((millis%3600000)/60000);return h+'h '+m+'m';};
let state=null,selectedPayment=null,usersCache=[],paymentsCache=[],pendingAction=null;
async function logout(){try{await api('logout',{})}catch{}location.href='/account.html';}
$('#logout-btn')?.addEventListener('click',logout);
function authTab(type){const register=type==='register';$('#tab-login')?.classList.toggle('selected',!register);$('#tab-register')?.classList.toggle('selected',register);toggle($('#auth-name-row'),register);text('#auth-title',register?'Create your Candriva account':'Welcome back');text('#auth-note',register?'A super admin reviews new accounts before the trial starts.':'Sign in using your private Candriva account.');text('#auth-submit',register?'Create account':'Sign in');$('#auth-password')?.setAttribute('autocomplete',register?'new-password':'current-password');$('#auth-form').dataset.mode=type;say('');}
$('#tab-login')?.addEventListener('click',()=>authTab('login'));$('#tab-register')?.addEventListener('click',()=>authTab('register'));
$('#auth-form')?.addEventListener('submit',async e=>{
 e.preventDefault();
 const register=$('#auth-form').dataset.mode==='register',email=$('#auth-email').value.trim(),password=$('#auth-password').value;
 const body={email,password,...(register?{name:$('#auth-name').value.trim()}:{})};
 try{await showLoading($('#auth-submit'),()=>api(register?'register':'login',body));say(register?'Account created. Manual review is required before the 72-hour trial begins.':'Signed in successfully.');await loadAccount();}catch(err){say(err.message,true)}
});
function renderAccount(a,sub){
 const member=sub?.account||a;
 text('#membership-status',subscriptionReadable(member.status));text('#membership-subline',member.access?'Research entitlement enabled':'Premium signals access unavailable');
 text('#trial-remaining',member.trialEnd?remaining(member.trialEnd):'Not started');text('#trial-end',member.trialEnd?'Ends '+date(member.trialEnd):'Starts after manual verification');
 text('#paid-until',date(member.paidUntil));text('#account-role',member.role==='superadmin'?'Super Admin':'Subscriber');
 text('#account-created','Joined '+date(member.createdAt));text('#account-name',member.name);text('#account-email',member.email);
 text('#account-verification',member.verified?'Reviewed':'Manual review pending');
 text('#account-subscription',subscriptionReadable(member.status));
 text('#trial-message',member.status==='pending_verification'?'Your account is registered, but the 72-hour trial has not started. Contact the operator for manual verification.':member.status==='trial'?'Your free 72-hour trial is active. '+remaining(member.trialEnd)+' remaining.':member.status==='active'?'Subscription active through '+date(member.paidUntil):member.status==='expired'?'Trial or subscription ended. Renewals require administrator approval.':member.status==='suspended'?'Account suspended. Contact support.':'Operator account');
 toggle($('#admin-nav'),member.role==='superadmin');toggle($('#admin-dashboard-link'),member.role==='superadmin');
 const payment=sub?.payment||{},available=!!payment.enabled;
 toggle($('#checkout-disabled'),!available);toggle($('#payment-form'),available);
 text('#payment-availability',available?'REVIEW REQUIRED':'NOT LIVE');
 if(available){text('#checkout-price','$'+Number(payment.priceUSD).toFixed(2)+' USDT equivalent');text('#checkout-network',payment.network);text('#checkout-wallet',payment.wallet);}
 const history=$('#payment-history');if(history){history.replaceChildren();const list=sub?.requests||[];if(!list.length)history.textContent='No payment requests.';for(const p of list){const row=document.createElement('div');row.className='mini-row';const summary=document.createElement('span');summary.textContent=date(p.createdAt)+' · '+p.network+' · '+p.txid;const status=document.createElement('b');status.textContent=p.status;row.append(summary,status);history.append(row)}}
}
async function loadAccount(){
 const me=await api('me');state=me.account;
 const signed=!!me.authenticated;toggle($('#auth-section'),!signed);toggle($('#account-section'),signed);
 toggle($('#logout-btn'),signed);if(!signed)return;
 try{const sub=await api('subscription');renderAccount(me.account,sub);}catch(e){say(e.message,true);}
}
$('#payment-form')?.addEventListener('submit',async e=>{
 e.preventDefault();const file=$('#receipt').files?.[0];if(!file||file.size>1400000||!['image/png','image/jpeg'].includes(file.type)){say('Upload a PNG or JPEG image under 1.4 MB.',true);return;}
 const sub=await api('subscription').catch(()=>null);if(!sub?.payment?.enabled){say('Payment submissions are currently disabled.',true);return;}
 const screenshot=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)});
 const txid=$('#txid').value.trim();if(!confirm('Confirm that you have independently verified the network and recipient. A screenshot alone does not prove payment. Submit your transaction for manual review?'))return;
 try{const result=await showLoading($('#payment-form button[type=submit]'),()=>api('payment_submit',{network:sub.payment.network,txid,screenshot}));say('Payment submitted for independent verification. ID: '+result.paymentId);$('#payment-form').reset();await loadAccount();}catch(err){say(err.message,true)}
});
$('#password-form')?.addEventListener('submit',async e=>{e.preventDefault();try{await showLoading($('#password-form button[type=submit]'),()=>api('change_password',{oldPassword:$('#password-old').value,newPassword:$('#password-new').value}));location.href='/account.html';}catch(err){say(err.message,true)}});
async function setup(){
 const tokenHash=location.hash.startsWith('#')?decodeURIComponent(location.hash.slice(1)):'';
 if(tokenHash){$('#setup-token').value=tokenHash;history.replaceState(null,'',location.pathname);}
 $('#setup-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const password=$('#setup-password').value,confirmPassword=$('#setup-confirm').value;
  if(password!==confirmPassword){say('Passwords do not match.',true);return;}
  const body={setupToken:$('#setup-token').value.trim(),email:$('#setup-email').value.trim(),name:$('#setup-name').value.trim(),password};
  try{await showLoading($('#setup-form button[type=submit]'),()=>api('setup_admin',body));location.replace('/admin.html');}catch(err){say(err.message,true)}
 });
}
function switchAdmin(name){
 $$('.admin-sections button').forEach(el=>el.classList.toggle('active',el.dataset.adminTab===name));
 $$('.admin-view').forEach(el=>el.hidden=el.id!=='tab-'+name);
 const names={overview:'Management overview',users:'Subscribers and trials',signals:'Research signal drafts',payments:'Payment verification',settings:'Subscription configuration',announcements:'Member announcements',audit:'Activity audit'};
 text('#admin-heading',names[name]||'Management');
 if(name==='overview')loadOverview();if(name==='users')loadUsers();if(name==='payments')loadPayments();if(name==='signals')loadSignals();if(name==='settings')loadSettings();if(name==='audit')loadAudit();
}
$$('[data-admin-tab]').forEach(el=>el.addEventListener('click',()=>switchAdmin(el.dataset.adminTab)));
function statCard(label,value){const div=document.createElement('article');const small=document.createElement('small'),strong=document.createElement('strong');small.textContent=label;strong.textContent=value;div.append(small,strong);return div;}
async function loadOverview(){try{const d=await api('admin_dashboard'),c=d.counts;
 const root=$('#admin-stats');root.replaceChildren();
 for(const [k,v] of [['Subscribers',c.users],['Pending review',c.pending],['Trial members',c.trial],['Paid members',c.active],['Expired',c.expired],['Suspended',c.suspended],['Pending payments',c.paymentsPending],['Verified',c.verified]])root.append(statCard(k,String(v)));
 text('#gate-payments',d.paymentsEnabled?'ENABLED':'DISABLED');text('#gate-signals',d.signalsEnabled?'ENABLED':'DISABLED');
 const list=$('#recent-users');list.replaceChildren();if(!d.recentUsers?.length)list.textContent='No subscribers registered yet.';
 for(const u of d.recentUsers||[]){const row=document.createElement('div');row.className='mini-row';const l=document.createElement('span');l.textContent=u.name+' · '+u.email;const r=document.createElement('b');r.textContent=subscriptionReadable(u.status);row.append(l,r);list.append(row)}
 }catch(err){say(err.message,true)}}
async function loadUsers(){try{const d=await api('admin_users');usersCache=d.users||[];renderUsers();}catch(err){say(err.message,true)}}
function userActionButtons(u){
 const area=document.createElement('div');area.className='admin-actions';
 const actions=u.role==='superadmin'?[]:u.status==='pending_verification'?[['verify','Start 72h trial','']]:[['grant','Grant days',''],[u.suspended?'restore':'suspend',u.suspended?'Restore':'Suspend',u.suspended?'':'danger'],['revoke','Revoke paid','danger']];
 for(const [type,label,style] of actions){const b=document.createElement('button');b.className='tiny-btn '+style;b.textContent=label;b.addEventListener('click',()=>confirmUser(u,type));area.append(b)}
 return area;
}
function renderUsers(){const filter=($('#user-filter')?.value||'').toLowerCase(),body=$('#users-body');body.replaceChildren();let displayed=0;
 for(const u of usersCache){if(!(u.name+' '+u.email+' '+u.status).toLowerCase().includes(filter))continue;displayed++;
 const tr=document.createElement('tr');const person=document.createElement('td');const b=document.createElement('strong'),s=document.createElement('small');b.textContent=u.name;s.textContent=u.email;person.append(b,s);
 for(const el of [person,...[subscriptionReadable(u.status),date(u.trialEnd),date(u.paidUntil)].map(v=>{const e=document.createElement('td');e.textContent=v;return e})])tr.append(el);
 const td=document.createElement('td');td.append(userActionButtons(u));tr.append(td);body.append(tr)}
 if(!displayed){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='No matching subscribers.';tr.append(td);body.append(tr)}
}
$('#user-filter')?.addEventListener('input',renderUsers);
$('#reload-users')?.addEventListener('click',loadUsers);
function confirmUser(u,type){pendingAction={uid:u.id,type};const names={verify:'Begin 72-hour trial',grant:'Grant paid access',suspend:'Suspend account',restore:'Restore account',revoke:'Revoke paid subscription'};text('#confirm-title',names[type]);text('#confirm-body',u.name+' · '+u.email+' — '+(type==='verify'?'This begins a non-repeatable 72-hour trial. Verify the account first.':'This action is recorded in the permanent audit trail.'));toggle($('#confirm-days-label'),type==='grant');toggle($('#confirm-reason-label'),['suspend','revoke'].includes(type));$('#confirm-reason').value='';$('#confirm-dialog').hidden=false;}
$('#cancel-confirm')?.addEventListener('click',()=>{$('#confirm-dialog').hidden=true;pendingAction=null});
$('#confirm-form')?.addEventListener('submit',async e=>{e.preventDefault();if(!pendingAction)return;
 const body={...pendingAction,days:Number($('#confirm-days').value),reason:$('#confirm-reason').value.trim()};
 try{await showLoading($('#confirm-form button[type=submit]'),()=>api('admin_user',body));$('#confirm-dialog').hidden=true;pendingAction=null;say('Subscriber updated.');await loadUsers();await loadOverview();}catch(err){say(err.message,true)}
});

async function loadSignals(){
 try{const result=await signalsAPI('admin_list'),all=result.signals||[],enabled=result.publicationEnabled;
   text('#signal-gate',enabled?'ENABLED':'DISABLED');
   text('#draft-count',String(all.filter(s=>s.status==='draft').length));
   text('#published-count',String(all.filter(s=>s.status==='published').length));
   const root=$('#signals-body');root.replaceChildren();
   if(!all.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='No private signal drafts yet.';tr.append(td);root.append(tr);}
   for(const s of all){const tr=document.createElement('tr');
     for(const value of [date(s.createdAt),s.symbol+' · '+s.side+' · '+s.timeframe,String(s.entry)+' / '+s.stop+' / '+s.target,s.status]){const td=document.createElement('td');td.textContent=value;tr.append(td)}
     const actions=document.createElement('td');
     if(s.status==='draft'){
       for(const [type,label] of [['publish','Publish'],['archive','Archive']]){const button=document.createElement('button');button.className='tiny-btn '+(type==='archive'?'danger':'');button.textContent=label;button.disabled=type==='publish'&&!enabled;
       button.title=type==='publish'&&!enabled?'Publication is disabled on the server':'Change draft status';
       button.onclick=async()=>{if(!confirm(type==='publish'?'Publish this verified research signal to subscribers?':'Archive this private draft?'))return;try{await signalsAPI('status',{id:s.id,status:type});say('Draft updated.');await loadSignals()}catch(e){say(e.message,true)}};actions.append(button)}
     }else actions.textContent=s.status;
     tr.append(actions);root.append(tr);
   }
 }catch(e){say(e.message,true)}
}
$('#refresh-signals')?.addEventListener('click',loadSignals);
$('#signal-draft-form')?.addEventListener('submit',async e=>{e.preventDefault();
 const form=$('#signal-draft-form'),payload={symbol:$('#draft-symbol').value,side:$('#draft-side').value,timeframe:$('#draft-timeframe').value,entry:Number($('#draft-entry').value),stop:Number($('#draft-stop').value),target:Number($('#draft-target').value),rationale:$('#draft-rationale').value.trim()};
 try{await showLoading(form.querySelector('[type=submit]'),()=>signalsAPI('draft',payload));form.reset();say('Private research draft saved. It is not published.');await loadSignals()}catch(err){say(err.message,true)}
});
async function loadPayments(){try{const r=await api('admin_payments');paymentsCache=r.payments||[];renderPayments();}catch(e){say(e.message,true)}}
function renderPayments(){const root=$('#payments-body');root.replaceChildren();if(!paymentsCache.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=6;cell.textContent='No payment submissions.';row.append(cell);root.append(row);return}
 for(const p of paymentsCache){const tr=document.createElement('tr');for(const value of [date(p.createdAt),p.email,p.network+' · '+p.txid.slice(0,12)+'…','$'+p.amountUSD,p.status]){const td=document.createElement('td');td.textContent=value;tr.append(td)}const actions=document.createElement('td');if(p.status==='pending'){const btn=document.createElement('button');btn.className='tiny-btn';btn.textContent='Review';btn.onclick=()=>reviewPayment(p);actions.append(btn)}else{actions.textContent=p.decision?.note||p.status;}tr.append(actions);root.append(tr)}
}
$('#reload-payments')?.addEventListener('click',loadPayments);
function reviewPayment(p){selectedPayment=p;$('#review-box').hidden=false;text('#review-desc',p.email+' · '+p.network+' · '+p.txid+' · expected $'+p.amountUSD+' · recipient '+p.wallet);$('#review-image').href='/api/candriva?action=evidence&id='+p.id;$('#verify-onchain').checked=false;$('#review-notes').value='';$('#review-box').scrollIntoView({behavior:'smooth'});}
async function paymentDecision(decision){if(!selectedPayment)return;if(decision==='approve'&&!$('#verify-onchain').checked){say('Independent on-chain verification must be confirmed first.',true);return}
 if(decision==='approve'&&!confirm('Confirm you verified transaction details independently, and grant this user 30 days?'))return;
 try{const r=await api('admin_payment',{paymentId:selectedPayment.id,decision,onChainVerified:$('#verify-onchain').checked,note:$('#review-notes').value.trim()});selectedPayment=null;$('#review-box').hidden=true;say('Payment '+r.decision+'.');await loadPayments();await loadOverview();}catch(e){say(e.message,true)}
}
$('#approve-payment')?.addEventListener('click',()=>paymentDecision('approve'));$('#reject-payment')?.addEventListener('click',()=>paymentDecision('reject'));
async function loadSettings(){try{const d=await api('admin_settings');text('#config-payment-gate',d.paymentGate?'ENABLED':'DISABLED');text('#config-signal-gate',d.signalsGate?'ENABLED':'DISABLED');if(d.settings?.priceUSD)$('#settings-price').value=d.settings.priceUSD;if(d.settings?.wallet)$('#settings-wallet').value=d.settings.wallet;if(d.settings?.network)$('#settings-network').value=d.settings.network;}catch(e){say(e.message,true)}}
$('#settings-form')?.addEventListener('submit',async e=>{e.preventDefault();if(!confirm('Save the payment recipient? This does not enable checkout.'))return;
 try{await showLoading($('#settings-form button[type=submit]'),()=>api('admin_settings_save',{priceUSD:$('#settings-price').value,network:$('#settings-network').value,wallet:$('#settings-wallet').value.trim()}));say('Payment settings saved privately. Public checkout remains subject to its server-side gate.');await loadSettings();}catch(err){say(err.message,true)}
});
$('#announcement-form')?.addEventListener('submit',async e=>{e.preventDefault();try{await showLoading($('#announcement-form button[type=submit]'),()=>api('admin_announcement',{title:$('#announcement-title').value,message:$('#announcement-message').value}));say('Announcement saved for authenticated users.');$('#announcement-form').reset();}catch(err){say(err.message,true)}});
async function loadAudit(){try{const r=await api('admin_audit');const root=$('#audit-list');root.replaceChildren();const items=r.events||[];if(!items.length)root.textContent='No audit events.';
 for(const e of items){const el=document.createElement('div');el.className='mini-row';const left=document.createElement('span');left.textContent=e.type.replaceAll('_',' ')+' · '+date(e.at);const right=document.createElement('small');right.textContent=e.subject?e.subject.slice(0,12)+'…':e.paymentId?e.paymentId.slice(0,10)+'…':'Recorded';el.append(left,right);root.append(el)}}catch(e){say(e.message,true)}}
$('#reload-audit')?.addEventListener('click',loadAudit);
async function adminInit(){try{const r=await api('me'),admin=r.account?.role==='superadmin';toggle($('#admin-lock'),!admin);toggle($('#admin-sections'),admin);text('#admin-status',admin?'● AUTHENTICATED ADMIN':'ACCESS RESTRICTED');if(admin)await loadOverview();}catch(err){toggle($('#admin-lock'),true);say(err.message,true)}}
if($('#setup-form'))setup();
if($('#auth-form')){authTab('login');loadAccount().catch(e=>say(e.message,true));setInterval(()=>{if(state){const e=$('#trial-remaining');if(e)e.textContent=state.trialEnd?remaining(state.trialEnd):'Not started'}},60000);}
if($('#admin-stats'))adminInit();
})();