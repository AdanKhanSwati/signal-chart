(()=>{'use strict';
const $=id=>document.getElementById(id);
const menu=$('menu-toggle'),mobile=$('mobile-nav');
if(menu&&mobile){
 menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));mobile.hidden=!open;menu.setAttribute('aria-label',open?'Close menu':'Open menu');});
 mobile.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{mobile.hidden=true;menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Open menu');}));
}
// Render the actual same-origin terminal, not a fabricated product mockup.
// Load only near the viewport on desktop to avoid doubling mobile data usage.
const wrap=$('terminal-frame-wrap'),frame=$('terminal-preview');
if(wrap&&frame){
 const screen=wrap.querySelector('.device-screen'),tap=wrap.querySelector('.device-tap');
 let started=false,selected='',observed=false;
 const narrow=()=>!window.matchMedia('(min-width:621px)').matches;
 function fit(){
  if(!screen)return;
  const mobile=narrow(),virtualWidth=mobile?390:1440,virtualHeight=mobile?900:1120;
  const width=screen.getBoundingClientRect().width||virtualWidth;
  screen.style.setProperty('--preview-width',virtualWidth+'px');
  screen.style.setProperty('--preview-height',virtualHeight+'px');
  screen.style.setProperty('--preview-scale',String(Math.min(1,width/virtualWidth)));
  screen.style.aspectRatio=virtualWidth+'/'+virtualHeight;
  const next=mobile?(frame.dataset.mobileSrc||'/app.html'):(frame.dataset.src||'/terminal.html');
  if(tap){tap.href=next;tap.setAttribute('aria-label',mobile?'Open complete SignalChart mobile workspace':'Open complete SignalChart terminal');}
  if(started&&next!==selected){selected=next;wrap.classList.remove('is-loaded');frame.src=next;}
  else selected=next;
 }
 frame.addEventListener('load',()=>wrap.classList.add('is-loaded'));
 fit();
 function boot(){if(started)return;started=true;frame.src=selected;}
 if('ResizeObserver'in window&&screen)new ResizeObserver(fit).observe(screen);
 else window.addEventListener('resize',fit,{passive:true});
 window.addEventListener('resize',fit,{passive:true});
 if('IntersectionObserver'in window){
  const observer=new IntersectionObserver(entries=>{
   if(entries.some(x=>x.isIntersecting)){observer.disconnect();observed=true;boot();}
  },{rootMargin:'120px'});
  observer.observe(wrap);
 }else{observed=true;boot();}
}
const feeds=[
 ['lp-btc','lp-btc-source','lp-btc-chart','crypto','BTCUSDT',2],
 ['lp-eth','lp-eth-source','lp-eth-chart','crypto','ETHUSDT',2],
 ['lp-eur','lp-eur-source','lp-eur-chart','forex','EURUSD',5],
 ['lp-gbp','lp-gbp-source','lp-gbp-chart','forex','GBPUSD',5]
];
const fmt=(n,d)=>n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
async function read(url,timeout=6700){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)throw Error('Market provider not available');return await r.json();}finally{clearTimeout(t);}}
function showChart(svg,bars){
 if(!svg||!bars||bars.length<8)return;
 const values=bars.slice(-30).map(b=>Number(b.close));
 if(values.some(v=>!Number.isFinite(v)||v<=0))return;
 const mn=Math.min(...values),mx=Math.max(...values),span=Math.max(mx-mn,Math.abs(mx)*.002);
 const coords=values.map((v,i)=>[2+i*106/Math.max(1,values.length-1),39-(v-mn)/span*33]);
 const d=coords.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
 const p=svg.querySelector('path');if(p)p.setAttribute('d',d);
 svg.classList.toggle('negative',values.at(-1)<values[0]);
}
async function load([outId,captionId,svgId,market,symbol,digits]){
 const out=$(outId),caption=$(captionId),svg=$(svgId);
 if(!out||!caption)return 'unavailable';
 try{
  const data=await read('/api/candles?market='+market+'&symbol='+symbol+'&interval=1h');
  const candles=Array.isArray(data.candles)?data.candles:[];
  const last=candles.at(-1),price=Number(last?.close),time=Number(last?.time);
  if(!(price>0&&time>0&&candles.length>=12&&typeof data.source==='string'&&data.source))throw Error('No validated source candles');
  out.textContent=fmt(price,digits);
  const date=new Date(time*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  // Some provider fallbacks supply USD spot references when USDT candles fail.
  // Do not mislabel these as executable USDT/perpetual quotes.
  const kind=market==='forex'?'Indicative OHLC':data.instrument==='perpetual'?'Perpetual history':data.instrument==='spot_reference'||data.aliasOnly?'USD spot ref':'Spot history';
  caption.textContent=kind+' · '+date;
  caption.title='Source: '+data.source+'; historical candles, not broker order quotes';
  showChart(svg,candles);
  return data.instrument==='spot_reference'||data.aliasOnly?'spot_reference':'historical';
 }catch{
  if(market==='forex'){
   try{
    const daily=await read('/api/quotes?market=forex&symbol='+symbol,4800),rate=daily?.quotes?.[symbol];
    if(daily.referenceOnly!==true||rate?.indicative!==true||!(Number(rate.price)>0)||!/^\d{4}-\d{2}-\d{2}$/.test(String(rate.referenceDate)))throw Error('Invalid daily reference');
    out.textContent=fmt(Number(rate.price),digits);
    caption.textContent='Daily indicative · '+rate.referenceDate;
    caption.title='Reference-only: '+String(rate.source||daily.source||'Daily forex reference');
    // Never fabricate an intraday FX sparkline from one daily reference rate.
    return 'daily_reference';
   }catch{}
  }
  out.textContent='—';caption.textContent='Source temporarily unavailable';return 'unavailable';
 }
}
Promise.all(feeds.map(load)).then(results=>{
 const available=results.filter(r=>r!=='unavailable').length;
 const status=$('lp-status');
 if(status)status.textContent=available===4?'4 / 4 SOURCES AVAILABLE':available?`${available} / 4 SOURCES AVAILABLE`:'SOURCES TEMPORARILY UNAVAILABLE';
});
})();