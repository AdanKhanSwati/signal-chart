(()=>{'use strict';
/**
 * SignalChart hourly publication overview.
 * Display public, non-actionable signal metadata ONLY.
 * All premium entry/stop/target/research comes from authenticated POST unlock
 * in sc-trial-ui.js, which is the single source of trial credit accounting.
 */
const $=id=>document.getElementById(id);
const status=$('sh-status'),area=$('sh-setups'),wallet=$('sh-wallet');
if(!status||!area||!wallet)return;
let running=false;
const make=(tag,cls,content)=>{
 const e=document.createElement(tag);if(cls)e.className=cls;
 if(content!==undefined)e.textContent=String(content);
 return e;
};
const setStatus=(message,error=false)=>{
 status.classList.toggle('error',error);
 const span=status.querySelector('span');
 if(span)span.textContent=message;else status.textContent=message;
};
const clear=()=>area.replaceChildren();
function empty(title,description){
 clear();const card=make('div','sh-empty');
 card.append(make('strong','',title),make('p','',description));
 area.append(card);
}
function riskNote(){
 const value=Number(wallet.value),help=$('sh-wallet-help');
 if(!help)return;
 if(Number.isFinite(value)&&value>0&&value<=100000000){
  const risk=value*.005;
  help.textContent='Illustrative maximum risk budget at 0.5%: $'+risk.toLocaleString('en-US',
   {minimumFractionDigits:2,maximumFractionDigits:2})+'. Not a trading recommendation; actual loss may exceed a stop.';
 }else{
  help.textContent='Optional wallet calculator. Signal details remain protected until you explicitly unlock them.';
 }
}
function show(rows){
 clear();
 if(!rows.length){
  empty('NO ACTIVE PREMIUM SIGNALS',
   'No verified qualifying signals are published at the moment. The system can correctly produce zero trades when data, market conditions or risk filters fail.');
  return;
 }
 const list=make('div','sh-monitor');
 for(const item of rows.slice(0,8)){
  const card=make('article','sh-item');
  const header=make('div','sh-item-title');
  header.append(make('strong','',item.asset),make('span','sh-badge','PREVIEW'));
  card.append(header);
  const published=item.publishedAt?new Date(item.publishedAt):null;
  const posted=published&&Number.isFinite(published.getTime())
   ?published.toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
   :'Time unavailable';
  const meta=make('div','sh-item-meta');
  meta.append(make('span','',item.market.toUpperCase()),make('span','',posted));
  card.append(meta);
  card.append(make('p','sh-invalid',
   'Strategy, entry levels and risk details are protected. Opening this preview does not consume a trial credit.'));
  const link=make('a','sp-cta','Open in signal vault ↗');
  link.href='#sc-trial-signals';
  link.setAttribute('aria-label','Open protected signal vault for '+item.asset);
  card.append(link);list.append(card);
 }
 area.append(list);
}
async function refresh(){
 if(running)return;running=true;
 const button=$('sh-refresh');if(button)button.disabled=true;
 setStatus('Checking latest published signals…');
 try{
  const [feedResult,healthResult]=await Promise.allSettled([
   fetch('/api/premium-signals?action=list',{cache:'no-store'}).then(async res=>{
    if(!res.ok)throw Error('Premium signal feed unavailable');
    return res.json();
   }),
   fetch('/api/research?mode=health',{cache:'no-store'}).then(res=>res.ok?res.json():null)
  ]);
  if(feedResult.status!=='fulfilled')throw Error('Premium signal feed is temporarily unavailable');
  const payload=feedResult.value;
  if(!Array.isArray(payload?.signals))throw Error('Invalid signal feed');
  const rows=payload.signals.filter(s=>s&&typeof s.asset==='string'&&
   typeof s.signalKey==='string'&&(s.market==='crypto'||s.market==='forex'));
  show(rows);
  const health=healthResult.status==='fulfilled'?healthResult.value:null;
  const automaticActive=health?.unattendedPublishing?.enabled===true;
  setStatus(rows.length+' active premium preview'+(rows.length===1?'':'s')+
   (automaticActive?' · automatic scan enabled':' · automatic publishing not yet verified'));
  const cycle=$('sh-cycle');
  if(cycle)cycle.textContent=automaticActive?'NEXT AUTOMATIC SCAN · HOURLY':'AUTOMATIC SCANS · NOT YET ACTIVE';
  const at=$('sh-research-time');
  if(at)at.textContent='Updated '+new Date().toLocaleTimeString([],
   {hour:'2-digit',minute:'2-digit'})+' · Published signal timestamps are shown in your local time zone.';
 }catch(e){
  setStatus(e.message||'Signal overview unavailable',true);
  empty('Signal feed unavailable','Unable to verify current published setups. No prices or trading directions have been estimated.');
 }finally{running=false;if(button)button.disabled=false}
}
wallet.addEventListener('input',()=>{try{
 if(wallet.value)localStorage.setItem('signalchart-wallet-size-v1',wallet.value);
 else localStorage.removeItem('signalchart-wallet-size-v1');
}catch{}riskNote()});
try{const v=localStorage.getItem('signalchart-wallet-size-v1');if(v&&Number(v)>0)wallet.value=v}catch{}
riskNote();const refreshButton=$('sh-refresh');if(refreshButton)refreshButton.addEventListener('click',refresh);
refresh();
setInterval(()=>{if(!document.hidden)refresh()},5*60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
})();
