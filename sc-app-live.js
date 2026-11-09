(()=>{'use strict';
const $=id=>document.getElementById(id);
const fmt=(v,d)=>Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
window.addEventListener('signalchart:tick',event=>{
 const updates=event.detail?.updates||{};let changed=false,last=0;
 for(const [symbol,short]of[['BTCUSDT','BTC'],['ETHUSDT','ETH'],['SOLUSDT','SOL']]){
  const item=updates[symbol];if(!(Number(item?.price)>0))continue;
  const out=$('app-price-'+short),changeEl=$('app-change-'+short);
  if(!out||!changeEl)continue;
  out.textContent='$'+fmt(item.price,item.price<10?4:2);
  const change=Number(item.changePercent)||0;
  changeEl.textContent=(change>0?'+':'')+fmt(change,2)+'% 24h';
  changeEl.classList.toggle('down',change<0);
  last=Math.max(last,Date.parse(item.asof)||0);changed=true;
 }
 if(changed)$('app-stream-state').textContent='LIVE · Binance Futures · '+(last?new Date(last).toLocaleTimeString():'Source time unavailable');
});
window.addEventListener('signalchart:feed-status',event=>{
 if(event.detail?.connected===false)$('app-stream-state').textContent='Stream reconnecting · snapshot fallback';
});
})();