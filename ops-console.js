(()=>{'use strict';
const $=id=>document.getElementById(id),storageKey='signalchart-superadmin-auth-v1';
let sb=null,active='overview',tickets=[],offset=0,filter='open',selected=null,inboxBusy=false,requestSeq=0,refreshing=false;
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
