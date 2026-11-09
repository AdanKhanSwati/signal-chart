(()=>{'use strict';
const $=id=>document.getElementById(id),fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const el=(tag,txt,cls)=>{const n=document.createElement(tag);n.textContent=txt;if(cls)n.className=cls;return n};
async function loadMarkets(){
 const label=$('app-stream-state');try{
 const r=await fetch('/api/quotes?market=crypto',{cache:'no-store'});if(!r.ok)throw Error('Provider offline');const data=await r.json();
 let last=0;
 for(const [symbol,short]of[['BTCUSDT','BTC'],['ETHUSDT','ETH'],['SOLUSDT','SOL']]){
  const row=data.quotes?.[symbol];if(!row)continue;
  $('app-price-'+short).textContent='$'+fmt(row.price,row.price<10?4:2);
  const ch=$('app-change-'+short);const pct=Number(row.changePercent||0);ch.textContent=(pct>0?'+':'')+fmt(pct,2)+'% 24h';ch.classList.toggle('down',pct<0);
  last=Math.max(last,Date.parse(row.asof)||0)
 }
 label.textContent='Source: '+(data.source||'Market feed')+' · '+(last?new Date(last).toLocaleTimeString():'Timestamp unavailable');
 }catch{label.textContent='Market data temporarily unavailable · no estimated prices shown'}
}
async function events(){
 const root=$('app-events');root.replaceChildren();
 try{const r=await fetch('/api/research?mode=calendar&symbol=BTCUSDT',{cache:'no-store'});if(!r.ok)throw Error('Unavailable');const d=await r.json(),now=Date.now(),upcoming=(d.events||[]).filter(x=>Date.parse(x.scheduledAt)>now&&Date.parse(x.scheduledAt)<now+4*86400000).slice(0,3);
 $('app-calendar-health').textContent=d.coverage==='FULL_WEEK'?'Current economic calendar':'Event coverage incomplete';
 if(!upcoming.length){root.append(el('div',d.coverage==='FULL_WEEK'?'No listed high-impact releases in the next four days.':'Upcoming releases cannot be confirmed.','app-card app-note'));return}
 for(const v of upcoming){const card=el('div','','app-card app-event'),left=el('div',''),title=el('strong',v.currency+' · '+v.title),when=el('small',new Date(v.scheduledAt).toLocaleString());left.append(title,document.createElement('br'),when);card.append(left,el('span',String(v.impact||'').toUpperCase(),'app-high'));root.append(card)}
 }catch{$('app-calendar-health').textContent='Calendar feed unavailable';root.append(el('div','Economic calendar unavailable. Do not treat this as a safe trading window.','app-card app-note'))}
}
let installPrompt=null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('app-install').hidden=false});
$('app-install').onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('app-install').hidden=true}else alert('On Android Chrome, choose Install app from the browser menu.')};
if('serviceWorker'in navigator)navigator.serviceWorker.register('/ops-sw.js',{scope:'/'}).catch(()=>{});
loadMarkets();events();setInterval(()=>{if(!document.hidden&&!window.SignalChartFeed?.state?.connected)loadMarkets()},20000);
})();