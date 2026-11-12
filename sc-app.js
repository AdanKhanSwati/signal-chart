(()=>{'use strict';
const $=id=>document.getElementById(id),fmt=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const el=(tag,txt,cls)=>{const n=document.createElement(tag);n.textContent=txt;if(cls)n.className=cls;return n};
async function loadMarkets(){
 const label=$('app-stream-state');
 const symbols=[['BTCUSDT','BTC'],['ETHUSDT','ETH'],['SOLUSDT','SOL']];
 const results=await Promise.allSettled(symbols.map(async([symbol,short])=>{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6500);
  try{
   const res=await fetch('/api/candles?market=crypto&symbol='+symbol+'&interval=1h',
    {cache:'no-store',signal:controller.signal});
   if(!res.ok)throw Error('Provider unavailable');
   const data=await res.json(),bars=Array.isArray(data.candles)?data.candles:[];
   const last=bars.at(-1),price=Number(last?.close),stamp=Number(last?.time);
   if(!(price>0&&stamp>0&&data.source&&bars.length>=2))throw Error('Invalid history');
   // Historical candles are not a live ticker. Don't overwrite a fresher
   // Binance WebSocket update on the same mobile screen.
   const field=$('app-price-'+short),change=$('app-change-'+short);
   if(field.dataset.streamLive==='true'&&window.SignalChartFeed?.state?.connected)return data.source;
   field.textContent=price.toLocaleString('en-US',
    {minimumFractionDigits:price<10?4:2,maximumFractionDigits:price<10?4:2})+' '+(data.quoteCurrency||'USDT');
   const baseline=bars.findLast(b=>Number(b.time)<=stamp-24*3600&&Number(b.time)>=stamp-26*3600);
   const previous=Number(baseline?.close);
   if(previous>0){
    const percent=(price/previous-1)*100;
    change.textContent=(percent>0?'+':'')+fmt(percent,2)+'% / 24h';
    change.classList.toggle('down',percent<0);
   }else{
    change.textContent='Dated price history · 24h change unavailable';
    change.classList.remove('down');
   }
   return data.source;
  }catch{
   if($('app-price-'+short).dataset.streamLive!=='true'){
    $('app-price-'+short).textContent='—';
    $('app-change-'+short).textContent='Market source unavailable';
   }
   throw Error('Market source unavailable');
  }finally{clearTimeout(timeout)}
 }));
 const ok=results.filter(r=>r.status==='fulfilled');
 label.textContent=ok.length===3?'Crypto snapshots sourced · see exchange in charts':
  ok.length?'Partial source coverage · open terminal for details':
  'Market data temporarily unavailable · no estimated prices shown';
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
if('serviceWorker'in navigator)navigator.serviceWorker.register('/customer-sw.js',{scope:'/app.html'}).catch(()=>{});
loadMarkets();events();setInterval(()=>{if(!document.hidden&&!window.SignalChartFeed?.state?.connected)loadMarkets()},120000);
})();