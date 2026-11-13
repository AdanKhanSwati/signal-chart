(()=>{'use strict';
const $=id=>document.getElementById(id),storageKey='signalchart-superadmin-auth-v1';
let sb=null,active='overview',tickets=[],offset=0,filter='open',selected=null,inboxBusy=false,requestSeq=0,refreshing=false;
let paymentRecords=[],paymentCapabilities={},selectedPayment=null,selectedMember=null,grantWriteEnabled=false;
let deferredInstall=null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;const btn=$('op-install');if(btn&&!$('op-app').hidden)btn.hidden=false});
window.addEventListener('appinstalled',()=>{deferredInstall=null;const btn=$('op-install');if(btn)btn.hidden=true});
const VIEWS=['overview','inbox','payments','members','system'];
const date=v=>{if(!v)return 'None recorded';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString():'Unavailable'};
const text=(id,value)=>{const node=$(id);if(node)node.textContent=String(value??'—')};
function notice(value,error=false){const node=$('op-notice');node.hidden=!value;node.classList.toggle('error',error);node.textContent=value||''}
function element(tag,cls,value){const node=document.createElement(tag);if(cls)node.className=cls;if(value!==undefined)node.textContent=String(value);return node}
function errorMessage(err){return String(err?.message||'Request unavailable').slice(0,180)}
async function loadLibrary(){
 if(window.supabase?.createClient)return;
 await new Promise((resolve,reject)=>{
  const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  s.async=true;s.crossOrigin='anonymous';s.onload=resolve;s.onerror=()=>reject(Error('Cannot reach the authentication library.'));
  document.head.append(s);
 });
}
async function adminToken(){
 if(!sb)throw Error('Administrator session has not been initialized.');
 const result=await sb.auth.getSession();
 const token=result.data?.session?.access_token;
 if(!token)throw Error('Administrator session expired. Sign in again.');
 return token;
}
async function abandonSession(){
 $('op-app').hidden=true;
 $('op-tickets').replaceChildren();$('op-messages').replaceChildren();
 try{if(sb)await sb.auth.signOut()}catch{}
 location.replace('/admin/login');
}
async function request(path,{method='GET',data,privateApi=true}={}){
 const headers={Accept:'application/json'};
 if(privateApi)headers.Authorization='Bearer '+await adminToken();
 if(method==='POST')headers['Content-Type']='application/json';
 let response;
 try{
  response=await fetch(path,{method,headers,cache:'no-store',credentials:'same-origin',
   body:method==='POST'?JSON.stringify(data||{}):undefined});
 }catch{throw Error('Connection interrupted. Please try again.')}
 if(privateApi&&(response.status===401||response.status===403)){await abandonSession();throw Error('Administrator access expired or was revoked.')}
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(body.error||'Service temporarily unavailable ('+response.status+').');
 return body;
}
function showView(name){
 if(!VIEWS.includes(name))return;
 active=name;notice('');
 document.querySelectorAll('[data-op-view]').forEach(b=>{
  const on=b.dataset.opView===name;b.classList.toggle('active',on);
  if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
 });
 VIEWS.forEach(view=>{$('op-view-'+view).hidden=view!==name});
 if(name==='inbox'&&!inboxBusy)loadInbox().catch(err=>notice(errorMessage(err),true));
 if(name==='payments')loadPaymentRecords().catch(err=>notice(errorMessage(err),true));
 if(name==='system')refreshSystem().catch(err=>notice(errorMessage(err),true));
 if(name==='overview'||name==='members')refreshOverview().catch(err=>notice(errorMessage(err),true));
}
function renderOverview(data){
 const v=data.overview||{};
 for(const [id,key] of [['op-kpi-members','registeredUsers'],['op-kpi-open','openTickets'],
  ['op-kpi-resolved','resolvedTickets'],['op-kpi-paid','activePaidAccess'],
  ['op-member-count','registeredUsers'],['op-member-paid','activePaidAccess'],
  ['op-member-reconcile','unreconciledAccounts']]){
  const num=v[key];text(id,Number.isSafeInteger(num)&&num>=0?num.toLocaleString('en-US'):'—');
 }
 text('op-last-ticket',date(v.lastTicketAt));
 text('op-last-sync','Synced '+date(data.asOf));
 text('op-overview-note',v.unreconciledAccounts>0?
  v.unreconciledAccounts+' legacy account record(s) still require reconciliation. This does not authorize paid access.':
  'Summary contains source-verified database aggregates only.');
}
async function refreshOverview(){
 if(refreshing)return;refreshing=true;
 const btn=$('op-refresh-overview');btn.disabled=true;
 try{const data=await request('/api/admin-overview');
  if(!data.overview)throw Error('Incomplete database summary');
  renderOverview(data);
 }catch(error){
  for(const id of ['op-kpi-members','op-kpi-open','op-kpi-resolved','op-kpi-paid',
   'op-member-count','op-member-paid','op-member-reconcile'])text(id,'—');
  text('op-overview-note','The private overview could not be loaded. No values are estimated.');
  throw error;
 }finally{refreshing=false;btn.disabled=false}
}
function clearThread(){
 selected=null;requestSeq++;
 text('op-thread-title','Select a conversation.');
 text('op-thread-status','SELECT ONE');text('op-thread-meta','Message details appear here after you select a customer conversation.');
 $('op-messages').replaceChildren(element('p','op-empty','No conversation selected.'));
 $('op-reply-form').hidden=true;
}
function ticketRow(t){
 const b=element('button','op-ticket'),strong=element('strong','',t.subject||'Customer conversation');
 b.type='button';b.dataset.ticketId=t.ticketId;b.setAttribute('role','listitem');
 if(t.ticketId===selected?.ticketId)b.classList.add('selected');
 b.append(strong,element('small','',String(t.category||'general').toUpperCase()+' · '+date(t.lastAt)));
 b.onclick=()=>openTicket(t).catch(err=>notice(errorMessage(err),true));
 return b;
}
async function loadInbox(){
 if(inboxBusy)return;inboxBusy=true;
 const controls=['op-refresh-inbox','op-previous','op-next','op-filter'];
 controls.forEach(x=>$(x).disabled=true);
 $('op-inbox-error').hidden=true;
 const list=$('op-tickets');
 try{
  const data=await request('/api/cv-ops?action=admin_support&status='+encodeURIComponent(filter)+'&offset='+offset);
  if(!Array.isArray(data.tickets)||!data.page)throw Error('Invalid inbox response.');
  tickets=data.tickets;
  list.replaceChildren();
  if(!tickets.length)list.append(element('p','op-empty',filter==='open'?'No open conversations.':'No resolved conversations on this page.'));
  else tickets.forEach(t=>list.append(ticketRow(t)));
  text('op-list-count',tickets.length+' on this page');
  text('op-page','Page '+(Math.floor(offset/50)+1));
  $('op-previous').disabled=offset===0;
  $('op-next').disabled=data.page.nextOffset===null;
  $('op-next').dataset.nextOffset=data.page.nextOffset??'';
  if(selected&&!tickets.some(t=>t.ticketId===selected.ticketId))clearThread();
 }catch(error){
  tickets=[];clearThread();list.replaceChildren(element('p','op-empty','Unable to load private conversations.'));
  text('op-list-count','Unavailable');
  text('op-inbox-error',errorMessage(error));$('op-inbox-error').hidden=false;
  throw error;
 }finally{
  inboxBusy=false;$('op-refresh-inbox').disabled=false;$('op-filter').disabled=false;
  if(offset>0)$('op-previous').disabled=false;
 }
}
async function openTicket(t){
 const seq=++requestSeq;
 text('op-thread-title','Loading conversation…');
 $('op-messages').replaceChildren(element('p','op-empty','Loading verified message history…'));
 $('op-reply-form').hidden=true;
 const data=await request('/api/cv-ops?action=messages&ticketId='+encodeURIComponent(t.ticketId));
 if(seq!==requestSeq)return;
 if(!data.ticket||!Array.isArray(data.messages)||data.ticket.ticketId!==t.ticketId)throw Error('Invalid conversation data.');
 selected={ticketId:t.ticketId,uid:data.ticket.uid,status:data.ticket.status};
 text('op-thread-title',data.ticket.subject||'Conversation');
 text('op-thread-status',String(data.ticket.status||'').toUpperCase());
 text('op-thread-meta',String(data.ticket.category||'general').toUpperCase()+' · Updated '+date(data.ticket.lastAt));
 const messages=$('op-messages');messages.replaceChildren();
 if(!data.messages.length)messages.append(element('p','op-empty','No messages in this conversation.'));
 for(const m of data.messages){
  const node=element('div','op-message'+(m.from==='admin'?' admin':''));
  node.append(element('small','',m.from==='admin'?'SignalChart Support · '+date(m.at):'Customer · '+date(m.at)),
   element('p','',m.text||''));messages.append(node);
 }
 messages.scrollTop=messages.scrollHeight;
 $('op-reply-form').hidden=data.ticket.status!=='open';
 document.querySelectorAll('.op-ticket').forEach(b=>b.classList.remove('selected'));
 // The selected card may have been re-rendered while messages were loading.
 for(const b of $('op-tickets').children)if(b.dataset.ticketId===t.ticketId)b.classList.add('selected');
}
async function reply(event){
 event.preventDefault();if(!selected||selected.status!=='open')return;
 const message=$('op-reply-text').value.trim();
 if(!message||message.length>2000){notice('Write a message within 2,000 characters.',true);return}
 const btn=$('op-send-reply');btn.disabled=true;
 try{
  await request('/api/cv-ops?action=reply',{method:'POST',data:{ticketId:selected.ticketId,message}});
  $('op-reply-text').value='';notice('Reply sent to customer.');
  const t={...selected};await openTicket(t);
  await loadInbox();
 }catch(error){notice(errorMessage(error),true)}finally{btn.disabled=false}
}
async function closeThread(){
 if(!selected||selected.status!=='open')return;
 if(!confirm('Mark this support conversation as resolved?'))return;
 const btn=$('op-close-thread');btn.disabled=true;
 try{
  await request('/api/cv-ops?action=close_ticket',{method:'POST',data:{ticketId:selected.ticketId}});
  notice('Conversation marked as resolved.');clearThread();offset=0;await loadInbox(); 
 }catch(error){notice(errorMessage(error),true)}finally{btn.disabled=false}
}
async function refreshSystem(){
 const fields=[
  ['op-api-state','op-api-detail','/api/health',data=>({
   status:data.ok===true?'ONLINE':'DEGRADED',detail:data.ok===true?'Public API responds. This is not a trading release approval.':'API health check is incomplete.'})],
  ['op-scheduler-state','op-scheduler-detail','/api/auto-signals?action=status',data=>({
   status:data.publicationEnabled?'CONFIGURED':'DISABLED',
   detail:data.publicationEnabled?'Check signed signal history before launch.':'Automatic premium signal publishing remains disabled on staging.'})],
  ['op-calendar-state','op-calendar-detail','/api/research?mode=calendar',data=>({
   status:data.coverage==='FULL_WEEK'?'COVERED':'INCOMPLETE',
   detail:data.coverage==='FULL_WEEK'?'Current event coverage reported by research service.':'Calendar coverage is incomplete or unverified; do not assume a safe trading window.'})]
 ];
 await Promise.all(fields.map(async([statusId,detailId,path,render])=>{
  text(statusId,'CHECKING');
  try{const data=await request(path,{privateApi:false});const value=render(data);text(statusId,value.status);text(detailId,value.detail)}
  catch{ text(statusId,'UNAVAILABLE');text(detailId,'The source could not be verified. Retry later.')}
 }));
}

function summaryLine(label,value){
 const row=element('div','op-review-row');
 row.append(element('span','op-muted',label),element('strong','',value??'—'));
 return row;
}
function selectPayment(item){
 selectedPayment=item;
 const root=$('op-payment-details');root.replaceChildren();
 const lines=[
  ['Invoice reference',item.invoiceRef],['Account',item.email||item.userId],
  ['Blockchain',item.network],['Transaction ID',item.txid],
  ['Amount (satoshis)',Number(item.amountSats).toLocaleString('en-US')],
  ['Destination supplied',item.receivingWallet],
  ['Submission time',date(item.submittedAt)],
  ['Last review',item.lastReviewAction||'Pending'],
  ['Last review note',item.lastReviewReason||'None']
 ];
 lines.forEach(([label,value])=>root.append(summaryLine(label,value)));
 text('op-payment-state',String(item.lastReviewAction||'PENDING').toUpperCase());
 const ready=paymentCapabilities.canReview===true&&item.lastReviewAction!=='reject';
 $('op-payment-review-form').hidden=!ready;
 text('op-payment-disabled',ready?
  'Hold/reject actions are recorded permanently. Approving a payment is disabled.':
  'Review actions are currently disabled; no subscription will be activated.');
}
async function loadPaymentRecords(){
 const root=$('op-payment-list');
 text('op-payment-count','Loading…');
 root.replaceChildren(element('p','op-muted','Loading verified SQL ledger…'));
 try{
  const data=await request('/api/admin-payments');
  if(!Array.isArray(data.payments))throw Error('Invalid payment queue');
  paymentRecords=data.payments;paymentCapabilities=data.capabilities||{};
  text('op-payment-count',paymentRecords.length+' submitted');
  root.replaceChildren();
  if(!paymentRecords.length)root.append(element('p','op-empty','No migrated payment submissions. Earlier receipts have not been imported or verified.'));
  else for(const p of paymentRecords){
   const row=element('button','op-record');row.type='button';
   row.append(element('strong','',p.email||p.userId),
    element('small','',String(p.invoiceRef)+' · '+date(p.submittedAt)),
    element('small','',p.lastReviewAction||'Pending review'));
   row.onclick=()=>selectPayment(p);root.append(row);
  }
  if(selectedPayment){
   const same=paymentRecords.find(p=>p.id===selectedPayment.id);
   if(same)selectPayment(same);else{selectedPayment=null;$('op-payment-review-form').hidden=true;}
  }
 }catch(error){
  paymentRecords=[];root.replaceChildren(element('p','op-empty','Private payment ledger unavailable. Nothing was inferred.'));
  text('op-payment-count','Unavailable');throw error;
 }
}
async function recordPaymentReview(event){
 event.preventDefault();if(!selectedPayment||!paymentCapabilities.canReview)return;
 const btn=$('op-payment-submit'),action=$('op-payment-action').value,
  reason=$('op-payment-reason').value.trim();
 if(reason.length<5){notice('Provide a review reason of at least five characters.',true);return}
 if(action==='reject'&&!confirm('Reject this submitted payment? This audit event cannot be undone.'))return;
 btn.disabled=true;
 try{
  const outcome=await request('/api/admin-payments?action=review',{method:'POST',
   data:{paymentId:selectedPayment.id,action,reason}});
  if(outcome.recorded!==true)throw Error('The server did not confirm the review event.');
  notice('Payment review event recorded. No subscription was activated.');
  $('op-payment-reason').value='';await loadPaymentRecords();
 }catch(error){notice(errorMessage(error),true)}
 finally{btn.disabled=false}
}
async function searchMembers(event){
 if(event)event.preventDefault();
 const query=$('op-member-search').value.trim(),root=$('op-member-results');
 if(query.length<2)return notice('Enter at least two characters to search.',true);
 root.replaceChildren(element('p','op-muted','Searching verified customer profiles…'));
 try{
  const data=await request('/api/admin-members?q='+encodeURIComponent(query));
  if(!Array.isArray(data.members))throw Error('Invalid customer search response.');
  grantWriteEnabled=data.capabilities?.complimentaryGrants===true;
  root.replaceChildren();
  if(!data.members.length)root.append(element('p','op-empty','No registered customer matches.'));
  else for(const member of data.members){
   const item=element('button','op-record');item.type='button';
   item.append(element('strong','',member.email||member.userId),
    element('small','',member.name||'No public name'),
    element('small','',String(member.legacyStatus||'Unreconciled')));
   item.onclick=()=>selectMember(member);
   root.append(item);
  }
 }catch(error){root.replaceChildren(element('p','op-empty','Member search unavailable.'));notice(errorMessage(error),true)}
}
async function selectMember(member){
 selectedMember=member;
 text('op-selected-member',member.email+' · '+member.userId);
 text('op-grant-state','LOADING');
 const root=$('op-member-grants');root.replaceChildren(element('p','op-muted','Checking grant history…'));
 $('op-grant-form').hidden=true;
 try{
  const data=await request('/api/admin-members?action=grants&userId='+encodeURIComponent(member.userId));
  if(selectedMember?.userId!==member.userId)return;
  root.replaceChildren();
  if(!Array.isArray(data.grants))throw Error('Grant history response invalid');
  if(!data.grants.length)root.append(element('p','op-empty','No complimentary access grants recorded.'));
  for(const grant of data.grants){
   const row=element('div','op-grant-record');
   row.append(element('strong','',grant.active?'ACTIVE UNTIL '+date(grant.expiresAt):grant.revokedAt?'REVOKED':'EXPIRED'),
    element('small','',grant.reason),
    element('small','',grant.revokedAt?'Revoked '+date(grant.revokedAt):'Issued '+date(grant.issuedAt)));
   if(grant.active&&grantWriteEnabled){
    const revoke=element('button','op-outline op-revoke','Revoke grant');revoke.type='button';
    revoke.onclick=()=>revokeGrant(grant);row.append(revoke);
   }
   root.append(row);
  }
  const hasActive=data.grants.some(x=>x.active);
  $('op-grant-form').hidden=!grantWriteEnabled||hasActive;
  text('op-grant-state',hasActive?'ACTIVE GRANT':'NO ACTIVE GRANT');
  text('op-grant-note',hasActive?
   'An active grant must be revoked before another is issued.':
   grantWriteEnabled?'Complimentary access expires automatically. Paid status is unchanged.':
   'Complimentary membership actions are disabled on this environment.');
 }catch(error){
  root.replaceChildren(element('p','op-empty','Grant history unavailable.'));
  text('op-grant-state','UNAVAILABLE');notice(errorMessage(error),true);
 }
}
async function grantMember(event){
 event.preventDefault();
 if(!selectedMember||!grantWriteEnabled)return;
 const button=$('op-grant-submit'),reason=$('op-grant-reason').value.trim();
 const raw=$('op-grant-expiry').value,expires=Date.parse(raw);
 if(reason.length<5||!Number.isFinite(expires)||expires<=Date.now()+15*60*1000||expires>Date.now()+90*86400000){
  notice('Use a reason of at least five characters and an expiry within 90 days.',true);return;
 }
 if(!confirm('Grant time-limited complimentary access to '+selectedMember.email+'?'))return;
 button.disabled=true;
 try{
  const result=await request('/api/admin-members?action=grant',{method:'POST',
   data:{userId:selectedMember.userId,reason,expiresAt:new Date(expires).toISOString()}});
  if(result.recorded!==true)throw Error('The server did not confirm this grant.');
  notice('Complimentary membership grant recorded for '+selectedMember.email+'.');
  $('op-grant-reason').value='';await selectMember(selectedMember);
 }catch(error){notice(errorMessage(error),true)}
 finally{button.disabled=false}
}
async function revokeGrant(grant){
 if(!selectedMember||!grantWriteEnabled)return;
 const reason=prompt('Reason for revoking this complimentary grant (5–500 characters):');
 if(reason===null)return;
 if(reason.trim().length<5||reason.trim().length>500){
  notice('Revocation reason must be between 5 and 500 characters.',true);return;
 }
 if(!confirm('Revoke this complimentary grant? This action is audited and cannot be undone.'))return;
 try{
  const result=await request('/api/admin-members?action=revoke',{method:'POST',
   data:{grantId:grant.grantId,reason:reason.trim()}});
  if(result.revoked!==true)throw Error('Revocation was not confirmed.');
  notice('Complimentary grant revoked.');await selectMember(selectedMember);
 }catch(error){notice(errorMessage(error),true)}
}

async function boot(){
 try{
  const config=await request('/api/config',{privateApi:false});
  if(!config.authReady||!config.supabaseUrl||!config.supabaseAnonKey)throw Error('Administrator login service is not configured.');
  await loadLibrary();
  if(!window.supabase?.createClient)throw Error('Secure sign-in service is unavailable.');
  sb=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{
   storageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce'
  }});
  const token=await adminToken();
  const proof=await request('/api/admin-session');
  if(proof.authorized!==true)throw Error('Administrator authorization could not be verified.');
  $('op-app').hidden=false;$('op-auth').hidden=true;$('op-signout').hidden=false;
  // Register only after the administrator identity has passed the backend gate.
  // This service worker is restricted to /admin/ and deliberately never caches APIs.
  if('serviceWorker'in navigator){
   navigator.serviceWorker.register('/admin/sw.js',{scope:'/admin/'})
    .catch(()=>notice('Admin app installation helper is unavailable in this browser.',true));
  }
  $('op-install').hidden=false;
  $('op-install').onclick=async()=>{
   if(deferredInstall){
    const prompt=deferredInstall;deferredInstall=null;
    try{await prompt.prompt();const choice=await prompt.userChoice;
     if(choice?.outcome==='accepted')$('op-install').hidden=true;
    }catch{notice('Use your browser menu to install the admin app.',true)}
   }else{
    notice('On Android Chrome, open the browser menu and select Install app or Add to Home screen. The administrator app is separate from the customer app.');
   }
  };
  const session=(await sb.auth.getSession()).data?.session;
  if(session?.user?.email)text('op-identity',session.user.email);
  document.querySelectorAll('[data-op-view]').forEach(b=>b.onclick=()=>showView(b.dataset.opView));
  $('op-signout').onclick=()=>abandonSession();
  $('op-auth-retry').onclick=()=>location.reload();
  $('op-refresh-overview').onclick=()=>refreshOverview().catch(e=>notice(errorMessage(e),true));
  $('op-go-inbox').onclick=()=>showView('inbox');
  $('op-refresh-inbox').onclick=()=>loadInbox().catch(e=>notice(errorMessage(e),true));
  $('op-filter').onchange=e=>{filter=e.target.value;offset=0;clearThread();loadInbox().catch(err=>notice(errorMessage(err),true))};
  $('op-previous').onclick=()=>{offset=Math.max(0,offset-50);clearThread();loadInbox().catch(err=>notice(errorMessage(err),true))};
  $('op-next').onclick=()=>{const next=Number($('op-next').dataset.nextOffset);if(Number.isSafeInteger(next)&&next>offset){offset=next;clearThread();loadInbox().catch(err=>notice(errorMessage(err),true))}};
  $('op-reply-form').onsubmit=reply;$('op-close-thread').onclick=closeThread;
  $('op-refresh-system').onclick=()=>refreshSystem();
  $('op-refresh-payments').onclick=()=>loadPaymentRecords().catch(e=>notice(errorMessage(e),true));
  $('op-payment-review-form').onsubmit=recordPaymentReview;
  $('op-member-search-form').onsubmit=searchMembers;
  $('op-grant-form').onsubmit=grantMember;
  await Promise.allSettled([refreshOverview(),refreshSystem()]);
  window.addEventListener('focus',()=>{if(active==='inbox'&&!inboxBusy)loadInbox().catch(err=>notice(errorMessage(err),true))});
 }catch(error){
  $('op-app').hidden=true;$('op-auth').hidden=false;
  text('op-auth-message',errorMessage(error));
  $('op-auth-retry').hidden=false;
  $('op-auth-retry').onclick=()=>location.reload();
 }
}
boot();
})();
