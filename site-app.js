(()=>{'use strict';
const page=document.body.dataset.candPage, $=s=>document.querySelector(s);
const WALLET='bc1p3hkr3959rtl8rd4rds5p4par7q4lhz2x4q0rwpsfvc2njht3s77qt7v8tt';
const QR='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+Fwer+AQSZUaQQC65iUS6AXW8lJXQC6hXkq6AQUuiXQQD+qqqr+AAHP2QAAC+GIND4AMoqXlIgBqUbZT2AAgSOkAwB2+9hGoAClFL1IgDauSbWyATqeCGEQCfKCtn4AatDD9qABm1G6SGAAOdSFiAB/smrDqABHdvligBaIU7euAcp/2EMABKNoRX6ARvmWlKACby9Az2AWOmOU4ACyYVpfuAAEhIlFgD+HSrqqAQUvI3EAC66y5f4AXVLCu2QC6xC4VeAQRJClYQD+lOp0uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const qs=new URLSearchParams(location.search);
const show=(s,v)=>{const n=$(s);if(n)n.hidden=!v};
const txt=(s,t)=>{const n=$(s);if(n)n.textContent=t===undefined?'—':String(t??'—')};
const dt=s=>s?new Date(s).toLocaleString():'—';
const note=(s,bad=false)=>{const n=$('#cand-notice');if(!n)return;n.textContent=s||'';n.className=s?'cand-message'+(bad?' is-error':''):''};
const formatBTC=n=>n==null?'Price not set':Number(n).toFixed(8)+' BTC';
const fmtDate=s=>s?new Date(s).toLocaleString():'—';
let sb,authToken,currentThread=null,currentUid=null,opsData=null,userData=null,appPrompt=null,refreshTimer=null,receiptUrl=null;
function el(tag,cls,t){const x=document.createElement(tag);if(cls)x.className=cls;if(t!==undefined)x.textContent=t;return x}
function empty(node,msg){node.replaceChildren();node.append(el('p','cand-note',msg))}
function action(label,onclick,style){const b=el('button',style||'cand-btn-secondary',label);b.type='button';b.onclick=onclick;return b}
function entryRow(label,value){const d=el('div','cand-info-row');d.append(el('span','',label),el('strong','',value));return d}
async function initializeAuth(){
 const c=await fetch('/api/config',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(Error('Account service unavailable')));
 if(!c.authReady)throw Error('Account configuration is not ready.');
 await new Promise((resolve,reject)=>{if(window.supabase?.createClient)return resolve();const x=document.createElement('script');x.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';x.onload=resolve;x.onerror=()=>reject(Error('Cannot load sign-in library'));document.head.append(x)});
 sb=window.supabase.createClient(c.supabaseUrl,c.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
 const state=await sb.auth.getSession();authToken=state.data.session?.access_token;
 return !!authToken;
}
async function call(action,method='GET',payload){
 const data=await sb.auth.getSession();const token=data.data.session?.access_token;
 if(!token)throw Error('Sign in again to continue.');
 const opts={method,headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit'};
 if(method==='POST'){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(payload||{})}
 const r=await fetch(('/api/cv-ops?action='+encodeURIComponent(action.split('&')[0])+(action.includes('&')?'&'+action.slice(action.indexOf('&')+1):'')),opts);
 const obj=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(obj.error||'Request could not be completed.');
 return obj;
}
async function receiptBlob(id){
 const data=await sb.auth.getSession();const token=data.data.session?.access_token;
 const r=await fetch('/api/cv-ops?action=receipt&id='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+token},cache:'no-store'});
 if(!r.ok)throw Error('Screenshot unavailable.');return r.blob();
}
async function verifiedCheckout(action,method='GET',data,ref){
 const session=(await sb.auth.getSession()).data?.session,token=session?.access_token;
 if(!token)throw Error('Sign in to your administrator account.');
 const url='/api/checkout?action='+encodeURIComponent(action)+(ref?'&paymentId='+encodeURIComponent(ref):'');
 const opts={method,headers:{Authorization:'Bearer '+token},cache:'no-store'};
 if(method==='POST'){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(data||{})}
 const resp=await fetch(url,opts),j=await resp.json().catch(()=>({}));
 if(!resp.ok)throw Error(j.error||'Verification failed');return j;
}
async function liveBTCQuote(){
 const resp=await fetch('/api/checkout?action=quote',{cache:'no-store'});
 if(!resp.ok)throw Error('BTC/USD rate unavailable');return resp.json();
}
function drawQr(){
const c=$('#cand-qr');if(!c)return;
const raw=atob(QR),size=45,ctx=c.getContext('2d');const scale=5;
c.width=size*scale;c.height=size*scale;ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#090909';
for(let y=0;y<size;y++)for(let x=0;x<size;x++){const n=y*size+x;if((raw.charCodeAt(Math.floor(n/8))>>(7-n%8))&1)ctx.fillRect(x*scale,y*scale,scale,scale)}
}
async function fileData(file){
 if(!file||!['image/png','image/jpeg'].includes(file.type)||file.size>1400000||file.size<200)throw Error('Attach a PNG or JPEG receipt under 1.4 MB.');
 return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(Error('Unable to read screenshot'));r.readAsDataURL(file)})
}
function paymentStatus(p){return p.decision==='approved'?'Approved':p.decision==='rejected'?'Rejected':'Under review'}
async function loadBilling(){
 userData=await call('me');
 const u=userData.account,c=userData.checkout;
 show('#billing-main',true);
 txt('#cand-email',u.email);txt('#cand-plan',u.status==='administrator'?'Administrator':u.status==='active'?'Active subscription':u.status==='trial'?'Free trial':'Expired / renew to unlock');
 txt('#cand-status',u.status.toUpperCase());txt('#cand-trial',dt(u.trialEndsAt));txt('#cand-paid',dt(u.paidUntil));
 show('#cand-price-closed',!c.enabled);show('#cand-payment-form',c.enabled);
 txt('#cand-price',formatBTC(c.btcMonthly));txt('#cand-payment-open',c.enabled?formatBTC(c.btcMonthly)+'/ MONTH':'PRICE PENDING');
 const root=$('#cand-payment-history');root.replaceChildren();
 if(!userData.payments.length)empty(root,'No payment submissions yet.');
 for(const p of userData.payments){
 const card=el('div','cand-listitem'),d=el('div','cand-info-row');
 d.append(el('span','',paymentStatus(p)),el('strong','',formatBTC(p.priceBTC)));
 card.append(d,el('small','',dt(p.submittedAt)+' · '+p.txid.slice(0,16)+'…'));if(p.reviewNote)card.append(el('small','',p.reviewNote));root.append(card);
 }
}
async function billingSetup(){
 drawQr();
 try{const q=await liveBTCQuote();txt('#cand-conversion',q.btcMonthly.toFixed(8)+' BTC ≈ $20 USD · '+q.provider);txt('#cand-conversion-time','Rate '+dt(q.quotedAt)+'. Only a currently active invoice is payable.')}catch{txt('#cand-conversion','Current market rate unavailable.');}
 $('#cand-copy').onclick=async()=>{try{await navigator.clipboard.writeText(WALLET);note('Bitcoin wallet address copied.')}catch{note('Copy the address shown above.')}};
 $('#cand-payment-form').onsubmit=async e=>{
 e.preventDefault();const btn=$('#cand-submit');btn.disabled=true;note('Submitting payment for review…');
 try{
 const txid=$('#cand-txid').value.trim(),receipt=await fileData($('#cand-proof').files?.[0]);
 const result=await call('submit_payment','POST',{txid,receipt,note:$('#cand-note').value.trim()});
 note('Payment reference '+result.id+' submitted. We will review the blockchain transaction and screenshot.');
 $('#cand-payment-form').reset();await loadBilling();
 }catch(err){note(err.message,true)}finally{btn.disabled=false}
 };
 await loadBilling();
}
function ticketButton(ticket,click){const b=el('button','cand-listitem');b.type='button';b.append(el('strong','',ticket.subject||'Support message'),el('small','',(ticket.category||'general')+' · '+(ticket.status||'open')+' · '+dt(ticket.lastAt)));b.onclick=click;return b}
function renderMessages(events,root){root.replaceChildren();for(const m of events){const d=el('div','cand-bubble'+(m.from==='admin'?' admin':''));d.append(el('span','cand-sender',(m.from==='admin'?'SignalChart Support':'Customer')+' · '+dt(m.at)),el('p','',m.text));root.append(d)}root.scrollTop=root.scrollHeight}
async function openThread(ticket){
 currentThread=ticket.ticketId;currentUid=ticket.uid;
 const args='messages&ticketId='+encodeURIComponent(currentThread)+(page==='ops'?'&uid='+encodeURIComponent(currentUid):'');
 const r=await call(args);
 txt(page==='ops'?'#ops-thread-title':'#thread-title',r.ticket.subject||'Conversation');
 txt(page==='ops'?'#ops-thread-state':'#thread-state',r.ticket.status.toUpperCase());
 const root=$(page==='ops'?'#ops-messages':'#thread-messages');renderMessages(r.messages,root);
 show(page==='ops'?'#ops-reply-form':'#thread-reply-form',true);
}
async function loadSupport(){
 userData=await call('me');show('#support-main',true);
 const list=$('#ticket-list');list.replaceChildren();
 if(!userData.tickets.length)empty(list,'No conversations yet.');
 for(const t of userData.tickets)list.append(ticketButton(t,()=>openThread(t)));
 if(currentThread){const next=userData.tickets.find(t=>t.ticketId===currentThread);if(next)await openThread(next)}
}
async function supportSetup(){
 $('#ticket-form').onsubmit=async e=>{
 e.preventDefault();const b=$('#ticket-send');b.disabled=true;
 try{const t=await call('new_ticket','POST',{subject:$('#ticket-subject').value,category:$('#ticket-category').value,message:$('#ticket-message').value});note('Conversation created. Our team can reply here.');$('#ticket-form').reset();currentThread=t.ticketId;await loadSupport()}catch(e){note(e.message,true)}finally{b.disabled=false}
 };
 $('#thread-reply-form').onsubmit=async e=>{
 e.preventDefault();if(!currentThread)return;
 try{await call('reply','POST',{ticketId:currentThread,message:$('#thread-reply').value});$('#thread-reply').value='';note('Reply sent.');await loadSupport()}catch(e){note(e.message,true)}
 };
 await loadSupport();
 refreshTimer=setInterval(()=>{if(document.visibilityState==='visible')loadSupport().catch(()=>{})},22000);
}
function switchTab(name){
 document.querySelectorAll('[data-ops-tab]').forEach(b=>b.classList.toggle('active',b.dataset.opsTab===name));
 for(const x of ['payments','messages','settings'])show('#ops-tab-'+x,x===name);
}
async function updateResearchOps(){
 try{
  const r=await fetch('/api/research?mode=health',{cache:'no-store'});if(!r.ok)throw Error('Unavailable');
  const status=await r.json(),sched=status.unattendedPublishing||{};
  txt('#ops-publishing',sched.status==='RUNNING_RECENTLY'?'RECENT EXECUTION':'NOT AUTOMATED');
  txt('#ops-publishing-detail',sched.lastCronRun?.lastCheckedAt?'Last publishing check: '+dt(sched.lastCronRun.lastCheckedAt):'Unattended hourly scheduler is not connected.');
  txt('#ops-performance',status.backtest||'Historical simulations only');
 }catch{txt('#ops-publishing','STATUS UNAVAILABLE')}
 try{
  const r=await fetch('/api/research?mode=calendar',{cache:'no-store'});if(!r.ok)throw Error('Unavailable');
  const data=await r.json();txt('#ops-calendar',data.coverage==='FULL_WEEK'?'CURRENT':'COVERAGE INCOMPLETE');
  txt('#ops-calendar-detail',data.coverage==='FULL_WEEK'?data.highCount+' high-impact releases indexed.':'No signal should bypass missing calendar coverage.');
 }catch{txt('#ops-calendar','SOURCE UNAVAILABLE')}
}
async function loadOps(){
 const info=await call('admin');opsData=info;show('#ops-main',true);updateResearchOps().catch(()=>{});
 txt('#ops-pending',info.stats.pendingPayments);txt('#ops-tickets',info.stats.openTickets);txt('#ops-total',info.stats.totalPayments);
 const payments=$('#ops-payment-list');payments.replaceChildren();
 if(!info.payments.length)empty(payments,'No BTC payment submissions yet.');
 for(const p of info.payments){const b=el('button','cand-listitem');b.type='button';b.append(el('strong','',(p.email||'Member')+' · '+paymentStatus(p)),el('small','',formatBTC(p.priceBTC)+' · '+dt(p.submittedAt)));b.onclick=()=>openPayment(p);payments.append(b)}
 const tickets=$('#ops-ticket-list');tickets.replaceChildren();
 if(!info.tickets.length)empty(tickets,'No customer messages yet.');
 for(const t of info.tickets)tickets.append(ticketButton(t,()=>{switchTab('messages');openThread(t).catch(e=>note(e.message,true))}));
 if(!document.activeElement?.closest('#ops-settings-form')){$('#ops-price').value=info.billing.btcMonthly||'';$('#ops-enable').checked=!!info.billing.enabled;}
 if(qs.has('payment')){const p=info.payments.find(x=>x.id===qs.get('payment'));if(p)openPayment(p)}
 if(qs.has('ticket')){const t=info.tickets.find(x=>x.ticketId===qs.get('ticket'));if(t){switchTab('messages');await openThread(t)}}
}
function openPayment(p){
 const root=$('#ops-payment-detail');root.replaceChildren();
 root.append(entryRow('Member',p.email||'—'),entryRow('Submitted',dt(p.submittedAt)),entryRow('BTC amount quoted',formatBTC(p.priceBTC)),entryRow('Network','Bitcoin mainnet'),entryRow('Payment status',paymentStatus(p)));
 const tx=el('div','cand-code',p.txid);tx.style.margin='15px 0';root.append(tx);
 const buttons=el('div','cand-ops-action');
 const explorer=document.createElement('a');explorer.className='cand-btn-secondary';explorer.href='https://mempool.space/tx/'+encodeURIComponent(p.txid);explorer.target='_blank';explorer.rel='noopener noreferrer';explorer.textContent='Verify on blockchain ↗';buttons.append(explorer);
 const proof=action('View private screenshot',async()=>{
 try{const blob=await receiptBlob(p.id);if(receiptUrl)URL.revokeObjectURL(receiptUrl);receiptUrl=URL.createObjectURL(blob);let img=root.querySelector('img[data-proof]');if(!img){img=document.createElement('img');img.dataset.proof='true';img.alt='Customer payment screenshot';img.style.cssText='display:block;max-width:100%;max-height:360px;object-fit:contain;margin:14px 0;border-radius:8px;border:1px solid #ffffff20';root.insertBefore(img,root.querySelector('.cand-ops-action'))}img.src=receiptUrl;note('Receipt loaded. Verify its information against the blockchain.')}catch(e){note(e.message,true)}
 });buttons.append(proof);
 let chainPass=false;
 const verifyButton=action('Verify BTC amount & confirmations',async()=>{
  verifyButton.disabled=true;chainPass=false;
  try{const v=await verifiedCheckout('verify','GET',null,p.id);
   chainPass=!!v.verified;
   let status=root.querySelector('[data-chain-status]');
   if(!status){status=el('div','cand-banner');status.dataset.chainStatus='true';root.append(status)}
   status.textContent=(v.verified?'Blockchain verified · ':'Awaiting verification · ')+
     'Received '+Number(v.received?.receivedBTC||0).toFixed(8)+' BTC · '+Number(v.received?.confirmations||0)+' confirmations. '+v.reason;
   note(v.verified?'Chain verification passed. Review the submitted evidence before approval.':v.reason,!v.verified)
  }catch(e){note(e.message,true)}finally{verifyButton.disabled=false}
 });buttons.append(verifyButton);root.append(buttons);
 if(p.note){root.append(el('p','cand-note','Customer note: '+p.note))}
 if(p.decision==='pending'){
 const box=el('div','');box.style.marginTop='15px';const chk=document.createElement('input');chk.type='checkbox';chk.id='ops-confirm-'+p.id;
 const label=el('label','cand-field',' I verified the transaction, receiving address, amount and blockchain confirmation');label.style.display='flex';label.style.gap='8px';label.style.alignItems='center';label.prepend(chk);box.append(label);
 const noteInput=el('textarea','cand-input');noteInput.placeholder='Optional review note';noteInput.rows=2;noteInput.style.cssText='width:100%;min-height:60px';box.append(noteInput);
 const row=el('div','cand-ops-action');row.style.marginTop='10px';
 for(const decision of ['approved','rejected']){
 const button=action(decision==='approved'?'Approve & activate 30 days':'Reject payment',async()=>{
 if(decision==='approved'&&(!chk.checked||!chainPass)){note('Verify the blockchain amount and confirmations before approval.',true);return}
 if(!confirm('Confirm payment '+decision+'? This action will be recorded.'))return;
 button.disabled=true;
 try{const x=decision==='approved'?await verifiedCheckout('approve','POST',{paymentId:p.id,note:noteInput.value}):await call('review_payment','POST',{paymentId:p.id,decision,confirmedOnChain:false,note:noteInput.value});note(decision==='approved'?'Payment verified; membership extended to '+dt(x.paidUntil)+'.':'Payment rejected.');await loadOps()}catch(e){note(e.message,true)}finally{button.disabled=false}
 },decision==='approved'?'cand-btn':'cand-btn-secondary');row.append(button)
 }
 box.append(row);root.append(box);
 }else if(p.reviewNote){root.append(el('p','cand-note','Review note: '+p.reviewNote))}
}
async function installPush(){
 try{
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw Error('Push notifications are unavailable in this browser.');
 const data=await call('vapid');if(!data.enabled)throw Error('Push service is not configured.');
 const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Enable notifications in Android Chrome settings.');
 const worker=await navigator.serviceWorker.register('/ops-sw.js',{scope:'/'});
 await navigator.serviceWorker.ready;
 const key=data.publicKey.replace(/-/g,'+').replace(/_/g,'/'),raw=atob(key+'='.repeat((4-key.length%4)%4)),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 const sub=await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
 await call('push_subscribe','POST',{subscription:sub.toJSON()});
 note('Admin push notifications are enabled on this device.');
 }catch(e){note(e.message,true)}
}

async function testPush(){
 if(!('serviceWorker'in navigator)||!('Notification'in window))throw Error('Notifications require an Android browser with permission enabled.');
 if(Notification.permission!=='granted')throw Error('Grant notification permission before testing.');
 await navigator.serviceWorker.register('/ops-sw.js',{scope:'/'});
 const reg=await navigator.serviceWorker.ready;
 await reg.showNotification('SignalChart Ops · device test',{body:'Device notification displayed. Server-side payment push must be tested separately.',icon:'/ops-icon.svg',data:{url:'/ops.html'},tag:'local-device-test'});
 return {sent:1};
}
async function opsSetup(){
 document.querySelectorAll('[data-ops-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.opsTab));
 $('#ops-push').onclick=installPush;$('#ops-test-push').textContent='Test device alert';
 $('#ops-test-push').onclick=async()=>{const btn=$('#ops-test-push');btn.disabled=true;try{const data=await testPush();note('Local device alert displayed; this does not verify remote push delivery.')}catch(e){note(e.message,true)}finally{btn.disabled=false}};

 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();appPrompt=e});
 $('#ops-install').onclick=async()=>{
 if(appPrompt){appPrompt.prompt();await appPrompt.userChoice;appPrompt=null}
 else note('On Android Chrome: open the browser menu and select “Add to Home screen” or “Install app”.');
 };
 $('#ops-live-rate').onclick=async()=>{const b=$('#ops-live-rate');b.disabled=true;try{const q=await liveBTCQuote();$('#ops-price').value=q.btcMonthly.toFixed(8);txt('#ops-rate-info','USD $20 · '+q.provider+' · '+dt(q.quotedAt)+'. Save settings to publish this amount.');note('Live BTC conversion loaded. Save to activate the selected amount.')}catch(e){note(e.message,true)}finally{b.disabled=false}};
 $('#ops-settings-form').onsubmit=async e=>{
 e.preventDefault();
 try{const r=await call('save_billing','POST',{btcMonthly:$('#ops-price').value,enabled:$('#ops-enable').checked});note('Monthly BTC pricing saved. '+(r.settings.enabled?'Checkout is open.':'Checkout is paused.'));await loadOps();switchTab('settings')}catch(e){note(e.message,true)}
 };
 $('#ops-reply-form').onsubmit=async e=>{
 e.preventDefault();if(!currentThread)return;
 try{await call('reply','POST',{ticketId:currentThread,uid:currentUid,message:$('#ops-reply').value});$('#ops-reply').value='';const t=opsData.tickets.find(x=>x.ticketId===currentThread);await openThread(t);note('Reply delivered.')}catch(e){note(e.message,true)}
 };
 $('#ops-close-ticket').onclick=async()=>{
 if(!currentThread)return;
 try{await call('close_ticket','POST',{ticketId:currentThread,uid:currentUid});note('Conversation marked resolved.');await loadOps();switchTab('messages')}catch(e){note(e.message,true)}
 };
 await loadOps();refreshTimer=setInterval(()=>{if(document.visibilityState==='visible')loadOps().catch(()=>{})},25000);
}
async function boot(){
 try{
 const signed=await initializeAuth();
 if(!signed){show('#cand-signin',true);return}
 if(page==='billing')await billingSetup();
 else if(page==='support')await supportSetup();
 else if(page==='ops')await opsSetup();
 }catch(e){note(e.message,true);if(e.message.includes('Administrator')||e.message.includes('403'))show('#cand-signin',true)}
}
if(page)boot();
})();