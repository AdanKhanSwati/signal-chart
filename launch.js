(()=>{'use strict';const $=id=>document.getElementById(id);
const feeds=[['lp-btc','lp-btc-source','crypto','BTCUSDT',2],['lp-eur','lp-eur-source','forex','EURUSD',5]];
async function load([out,caption,market,symbol,digits]){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),7000);
 try{
  const url='/api/candles?market='+market+'&symbol='+symbol+'&interval=1h';
  const response=await fetch(url,{cache:'no-store',signal:abort.signal});
  if(!response.ok)throw Error('Provider unavailable');
  const data=await response.json(),last=data.candles?.at(-1),price=Number(last?.close),stamp=Number(last?.time);
  if(!(price>0&&stamp>0&&typeof data.source==='string'&&data.source))throw Error('No validated bars');
  $(out).textContent=price.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
  $(caption).textContent=(market==='forex'?'Indicative history':data.instrument==='perpetual'?'Perpetual candles':'Spot history')+' · '+new Date(stamp*1000).toLocaleDateString();
  $(caption).title=data.source;return true;
 }catch{
  $(out).textContent='Unavailable';$(caption).textContent='Source temporarily unavailable';return false;
 }finally{clearTimeout(timer)}
}
Promise.all(feeds.map(load)).then(results=>{
 $('lp-status').textContent=results.every(Boolean)?'Sources connected':results.some(Boolean)?'Partial sources':'Sources unavailable';
});
})();