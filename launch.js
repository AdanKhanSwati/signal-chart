(()=>{'use strict';
const $=id=>document.getElementById(id);
const prices=[['lp-btc','lp-btc-source','crypto','BTCUSDT',2],['lp-eur','lp-eur-source','forex','EURUSD',5]];
const amount=(n,d)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
async function request(url,timeout=6500){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
 try{const response=await fetch(url,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Unavailable');return await response.json();}
 finally{clearTimeout(timer)}
}
async function preview([out,caption,market,symbol,digits]){
 try{
  const data=await request('/api/candles?market='+market+'&symbol='+symbol+'&interval=1h');
  const bars=Array.isArray(data.candles)?data.candles:[];const last=bars.at(-1);
  const price=Number(last?.close),stamp=Number(last?.time);
  if(!(price>0&&stamp>0&&bars.length>=12&&typeof data.source==='string'&&data.source))throw new Error('No validated candles');
  $(out).textContent=amount(price,digits);
  $(caption).textContent=(market==='forex'?'Indicative OHLC':data.instrument==='perpetual'?'Perpetual OHLC':'Spot reference')+' · '+new Date(stamp*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  $(caption).title='Market source: '+data.source;
  return 'historical';
 }catch{
  // Forex historical feeds are unreliable on free infrastructure. An actual
  // dated daily reference may be shown, but never called live, broker, or OHLC.
  if(market==='forex'){
   try{
    const daily=await request('/api/quotes?market=forex&symbol='+symbol,5000),rate=daily?.quotes?.[symbol];
    if(daily.referenceOnly!==true||rate?.indicative!==true||!(Number(rate.price)>0)||!/^\d{4}-\d{2}-\d{2}$/.test(String(rate.referenceDate)))throw Error('No published daily reference');
    $(out).textContent=amount(Number(rate.price),digits);
    $(caption).textContent='Daily indicative · '+rate.referenceDate;
    $(caption).title=String(rate.source||daily.source||'Daily reference');
    return 'daily_reference';
   }catch{}
  }
  $(out).textContent='—';$(caption).textContent='Source temporarily unavailable';
  return 'unavailable';
 }
}
Promise.all(prices.map(preview)).then(results=>{
 const working=results.filter(x=>x!=='unavailable').length;
 $('lp-status').textContent=working===2?'SOURCES CONNECTED':working===1?'PARTIAL COVERAGE':'SOURCES UNAVAILABLE';
});
})();