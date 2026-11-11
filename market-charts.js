(()=>{'use strict';
const pairs=[
 {s:'BTCUSDT',label:'BTC / USDT',short:'BTC',icon:'₿',type:'crypto',d:2},
 {s:'ETHUSDT',label:'ETH / USDT',short:'ETH',icon:'Ξ',type:'crypto',d:2},
 {s:'SOLUSDT',label:'SOL / USDT',short:'SOL',icon:'S',type:'crypto',d:3},
 {s:'XRPUSDT',label:'XRP / USDT',short:'XRP',icon:'X',type:'crypto',d:5},
 {s:'DOGEUSDT',label:'DOGE / USDT',short:'DOGE',icon:'Ð',type:'crypto',d:6},
 {s:'EURUSD',label:'EUR / USD',short:'EUR',icon:'€',type:'forex',d:5},
 {s:'GBPUSD',label:'GBP / USD',short:'GBP',icon:'£',type:'forex',d:5},
 {s:'USDJPY',label:'USD / JPY',short:'JPY',icon:'¥',type:'forex',d:3}
], lookup=Object.fromEntries(pairs.map(p=>[p.s,p])), $=id=>document.getElementById(id);
const state={symbol:'BTCUSDT',interval:'1m',filter:'all',search:'',quotes:{},bars:[],chart:null,chartLines:[],chartObs:null,chartEngine:null,chartKey:null,volumeSeries:null,ema:true,loadId:0,abort:null,canvas:null,chartDraw:null,visibleCount:24,catalogCount:8,catalogSource:'Initial watchlist',candleSource:null};
const q=new URL(location.href).searchParams.get('pair');if(lookup[q])state.symbol=q;
const n=v=>Number(v),valid=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const fmt=(v,d)=>valid(v)?n(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const current=()=>lookup[state.symbol],status=(p,q)=>{if(!q||!valid(q.price))return 'UNAVAILABLE';if(q.reference===true)return 'REFERENCE';const age=Date.now()-Date.parse(q.asof||'');const maxAge=p.type==='forex'?20*60*1000:3*60*1000;return q.stale||!Number.isFinite(age)||age>maxAge?'DELAYED':'UPDATED'};
const safeTime=stamp=>{const d=new Date(stamp);return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})};
const source=p=>p.type==='forex'?'Indicative FX pricing':p.instrument==='spot'?'Binance Spot · reference chart':p.instrument==='perpetual'?'Binance USD-M Futures':'Crypto candles · checking data source';
function child(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function logoAsset(p){
 const el=child('span','mc-logo-mark');
 if(p.type==='crypto'){
  const symbol=String(p.base||p.s.replace(/USDT$/,'')).toLowerCase().replace(/^1000/,'');
  const img=child('img');img.alt='';img.loading='lazy';img.src='https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/'+symbol+'.png';img.onerror=()=>{img.onerror=null;img.src='https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/generic.png'};el.append(img)
 }else{
  const flags={EUR:'eu',USD:'us',GBP:'gb',JPY:'jp',CHF:'ch',CAD:'ca',AUD:'au',NZD:'nz',SGD:'sg',HKD:'hk',NOK:'no',SEK:'se',CNH:'cn',MXN:'mx',ZAR:'za',TRY:'tr',INR:'in',PKR:'pk'};
  for(const [i,s]of[p.s.slice(0,3),p.s.slice(3)].entries()){const img=child('img','mc-logo-flag mc-logo-flag-'+i);img.alt='';img.loading='lazy';img.src='https://flagcdn.com/w40/'+(flags[s]||'un')+'.png';img.onerror=()=>img.style.display='none';el.append(img)}
 }
 return el
}
function renderWatch(){
 const root=$('mc-watch-list');root.replaceChildren();
 const filtered=pairs.filter(p=>(state.filter==='all'||p.type===state.filter)&&(!state.search||(p.label+' '+p.short+' '+p.s).toLowerCase().includes(state.search)));
 const countLabel=document.querySelector('.mc-instruments .mc-panel-heading small');
 if(countLabel)countLabel.textContent=pairs.length.toLocaleString()+' markets';
 let group='';
 for(const p of filtered.slice(0,state.search?Math.max(100,state.visibleCount):state.visibleCount)){
  if(p.type!==group){group=p.type;root.append(child('div','mc-watch-group',p.type==='crypto'?'CRYPTO MARKETS':'FOREX PAIRS'))}
  const button=child('button','mc-watch-row'+(p.s===state.symbol?' active':''));button.type='button';button.dataset.mcSymbol=p.s;button.setAttribute('aria-pressed',String(p.s===state.symbol));
  const left=child('span','mc-watch-left'),right=child('span','mc-watch-right');
  left.append(logoAsset(p),child('strong','',p.label),child('small','',p.type==='crypto'?'Futures chart':'Indicative FX'));
  right.append(child('strong','',fmt(state.quotes[p.s]?.price,p.d)),child('small','',status(p,state.quotes[p.s])));
  button.append(left,right);root.append(button);
 }
 if(!filtered.length)root.append(child('p','', 'No matching markets.'));
 const limit=state.search?Math.max(100,state.visibleCount):state.visibleCount;
 if(filtered.length>limit){const more=child('button','mc-watch-more','Show more · '+(filtered.length-limit).toLocaleString()+' remaining');more.type='button';more.dataset.mcMore='true';root.append(more)}
}
function renderTable(){
 const tbody=$('mc-market-rows');tbody.replaceChildren();
 for(const p of pairs.slice(0,80)){
  const tr=document.createElement('tr'),quote=state.quotes[p.s],fields=[p.label,p.type==='crypto'?'Crypto':'Forex',fmt(quote?.price,p.d),status(p,quote)];
  for(const [i,v] of fields.entries()){
   const td=child('td',i===0?'mc-table-pair':i===2?'mc-table-price':i===3?'mc-status'+(v!=='UPDATED'?' delayed':''):'',v);
   tr.append(td)
  }
  const last=document.createElement('td'),open=child('button','', 'Open');open.type='button';open.dataset.mcSymbol=p.s;
  last.append(open);tr.append(last);tbody.append(tr)
 }
 $('mc-overview-updated').textContent='Prices refresh automatically';
}
let lastPaintedSymbol=null;
function renderQuote(){
 const p=current(),quote=state.quotes[p.s],s=status(p,quote);
 // Only rebuild the selected icon/title when the symbol changes. Refreshing
 // image DOM every three-second market tick was expensive on mobile.
 if(lastPaintedSymbol!==p.s){
  $('mc-pair-icon').replaceChildren(logoAsset(p));
  $('mc-pair-icon').classList.toggle('fx',p.type==='forex');
  $('mc-pair-title').textContent=p.label;
  $('mc-pair-market').textContent=p.type.toUpperCase();
  $('mc-next-title').textContent=p.type==='crypto'?'Explore crypto signals':'Explore forex signals';
  const link=$('mc-next-link');
  link.href=p.type==='crypto'?'/crypto.html':'/forex.html';
  link.textContent='View '+(p.type==='crypto'?'Crypto':'Forex')+' Signals ↗';
  lastPaintedSymbol=p.s;
 }
 $('mc-pair-source').textContent=state.candleSource?.symbol===p.s?state.candleSource.source:source(p);
 $('mc-price').textContent=fmt(quote?.price,p.d);
 $('mc-quote-asof').textContent=quote?(quote.reference?'Daily reference · '+quote.referenceDate:(s==='UPDATED'?'Latest quote · ':'Delayed quote · ')+safeTime(quote.asof)):'Awaiting market quote';
 const isUp=pairs.some(asset=>status(asset,state.quotes[asset.s])==='UPDATED');
 const hasFxReference=pairs.some(asset=>state.quotes[asset.s]?.reference===true);
 $('mc-market-connect').querySelector('i').classList.toggle('stale',!isUp);
 $('mc-market-connect').lastChild.textContent=isUp?' Quotes connected':hasFxReference?' Daily FX references available':' Market feed delayed';

}
async function loadQuotes(){
 // A single low-frequency reference snapshot, not a live broker quote feed.
 // Crypto prices continue to come from actual exchange candles/WebSockets.
 try{
  const r=await fetch('/api/quotes?market=forex',{cache:'no-store'});
  if(!r.ok)throw Error('Daily forex reference unavailable');
  const data=await r.json();
  if(data.referenceOnly!==true||!data.quotes)return;
  for(const [symbol,value]of Object.entries(data.quotes)){
   if(!lookup[symbol]||lookup[symbol].type!=='forex'||
      value?.reference!==true||!valid(value.price)||Number(value.price)<=0)continue;
   const previous=state.quotes[symbol];
   if(!previous||previous.reference||previous.stale)state.quotes[symbol]=value;
  }
 }catch{/* Never fabricate missing reference prices. */}
 renderWatch();renderTable();renderQuote();
}
function ema(bars,period){const k=2/(period+1);let value=bars[0]?.close||0;return bars.map((b,i)=>{value=i===0?b.close:k*b.close+(1-k)*value;return{time:b.time,value}})}
function rsi(bars){if(bars.length<15)return null;const arr=bars.slice(-15);let gains=0,losses=0;for(let i=1;i<arr.length;i++){const diff=arr[i].close-arr[i-1].close;gains+=Math.max(0,diff);losses+=Math.max(0,-diff)}
 if(!gains&&!losses)return 50;if(!losses)return 100;return 100-100/(1+gains/losses)}
function showIndicators(){
 const bars=state.bars,p=current(),last=bars.at(-1);$('mc-insights-time').textContent=state.interval.toUpperCase()+' candles';
 if(!last){for(const key of ['mc-ema20','mc-ema50','mc-rsi','mc-range'])$(key).textContent='—';return}
 const e20=ema(bars,20).at(-1).value,e50=ema(bars,50).at(-1).value,ind=rsi(bars);
 $('mc-ema20').textContent=fmt(e20,p.d);$('mc-ema50').textContent=fmt(e50,p.d);
 $('mc-rsi').textContent=ind===null?'—':fmt(ind,1);
 const last24=bars.slice(-24),low=Math.min(...last24.map(b=>b.low)),high=Math.max(...last24.map(b=>b.high));
 $('mc-range').textContent=fmt(low,p.d)+' – '+fmt(high,p.d);
}
let library=null;
function loadChartLibrary(){
 if(window.LightweightCharts)return Promise.resolve(window.LightweightCharts);
 if(library)return library;
 library=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';script.crossOrigin='anonymous';script.onload=()=>window.LightweightCharts?resolve(window.LightweightCharts):reject(Error('Chart library unavailable'));script.onerror=()=>reject(Error('Chart service unavailable'));document.head.append(script)});return library;
}
function clearChart(){
 if(state.chartObs){state.chartObs.disconnect();state.chartObs=null}
 if(state.chart){try{state.chart.remove()}catch{}state.chart=null}state.chartEngine?.destroy();state.chartEngine=null;state.candleSeries=null;state.volumeSeries=null;state.chartKey=null;
 $('mc-chart').replaceChildren();state.chartLines=[];state.canvas=null;state.chartDraw=null;
}
function renderWithLibrary(lib,bars){
 const area=$('mc-chart');const chart=lib.createChart(area,{
  width:Math.max(270,area.clientWidth),height:Math.max(220,area.clientHeight),
  layout:{background:{type:'solid',color:'#11141d'},textColor:'#e1dce5',fontSize:12,fontFamily:'Manrope,-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif'},
  grid:{vertLines:{color:'#292e3a'},horzLines:{color:'#292e3a'}},
  crosshair:{mode:lib.CrosshairMode.Normal,vertLine:{labelBackgroundColor:'#463328'},horzLine:{labelBackgroundColor:'#463328'}},
  rightPriceScale:{borderColor:'#343743',scaleMargins:{top:.11,bottom:.2}},
  timeScale:{borderColor:'#343743',timeVisible:true,secondsVisible:false,rightOffset:6},
  handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
  handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true}
 });
 state.chart=chart;
 const candles=chart.addCandlestickSeries({upColor:'#4bd4aa',downColor:'#ff6b75',wickUpColor:'#4bd4aa',wickDownColor:'#ff6b75',borderVisible:false,priceLineVisible:true});
 candles.setData(bars.map(({time,open,high,low,close})=>({time,open,high,low,close})));state.candleSeries=candles;
 const vol=chart.addHistogramSeries({priceScaleId:'',priceFormat:{type:'volume'},lastValueVisible:false,priceLineVisible:false});
 vol.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0}});
 vol.setData(bars.map(b=>({time:b.time,value:b.volume||0,color:b.close>=b.open?'#216b59':'#803a44'})));state.volumeSeries=vol;
 for(const [period,color]of[[20,'#ff9b59'],[50,'#ac9ddd']]){const l=chart.addLineSeries({color,lineWidth:2,priceLineVisible:false,lastValueVisible:false,visible:state.ema});l.setData(ema(bars,period));state.chartLines.push(l)}
 chart.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-76),to:bars.length+3});chart.subscribeCrosshairMove(param=>{const target=$('mc-hover-info');if(!target)return;const candle=param?.seriesData?.get(candles);target.textContent=candle&&param.time?'O '+fmt(candle.open,current().d)+' H '+fmt(candle.high,current().d)+' L '+fmt(candle.low,current().d)+' C '+fmt(candle.close,current().d):''});
 if('ResizeObserver'in window){state.chartObs=new ResizeObserver(()=>{if(state.chart!==chart||!area.isConnected)return;try{chart.applyOptions({width:Math.max(220,area.clientWidth),height:Math.max(220,area.clientHeight)})}catch{}});state.chartObs.observe(area)}
}
function renderFallback(bars){
 const root=$('mc-chart'),canvas=document.createElement('canvas');
 canvas.style.cssText='display:block;width:100%;height:100%;touch-action:none';
 canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Interactive candlestick market chart');
 root.append(canvas);state.canvas=canvas;
 state.chartEngine=window.SignalChartInteractive?.create(canvas,{ohlcTarget:$('mc-hover-info'),axisFontSize:12});
 if(!state.chartEngine)throw Error('Interactive chart unavailable');
 state.chartDraw=()=>state.chartEngine?.setData(state.bars,{symbol:state.symbol,timeframe:state.interval,digits:current().d});state.chartDraw();
}
// Hosted provider charts are last-resort visual references, not inputs for
// SignalChart's own technical indicators, signals, backtests or order decisions.
let hostedChartModule=null;
function hostedChartLibrary(){
 if(window.customElements?.get('tv-advanced-chart'))return Promise.resolve();
 if(hostedChartModule)return hostedChartModule;
 hostedChartModule=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.type='module';
  script.src='https://widgets.tradingview-widget.com/w/en/tv-advanced-chart.js';
  script.onload=()=>{
   if(!window.customElements?.whenDefined){resolve();return}
   Promise.race([
    window.customElements.whenDefined('tv-advanced-chart'),
    new Promise((_,fail)=>setTimeout(()=>fail(Error('Hosted chart unavailable')),6000))
   ]).then(resolve,reject);
  };
  script.onerror=()=>reject(Error('Hosted chart unavailable'));
  document.head.append(script);
 }).catch(e=>{hostedChartModule=null;throw e});
 return hostedChartModule;
}
const TV_INTERVALS={'1m':'1','3m':'3','5m':'5','15m':'15','30m':'30',
 '1h':'60','4h':'240','1d':'1D','1w':'1W'};
async function renderHostedChart(p,interval,id){
 $('mc-chart-loading').textContent='Checking an alternative hosted chart…';
 try{
  await hostedChartLibrary();
  if(id!==state.loadId)return;
  clearChart();
  const root=$('mc-chart'),widget=document.createElement('tv-advanced-chart');
  const symbol=(p.type==='forex'?'FX:':'BINANCE:')+p.s;
  widget.setAttribute('symbol',symbol);
  widget.setAttribute('interval',TV_INTERVALS[interval]||'15');
  widget.setAttribute('theme','dark');
  widget.setAttribute('timezone','Etc/UTC');
  widget.setAttribute('hide-volume','true');
  widget.style.cssText='display:block;width:100%;height:100%;min-height:250px';
  root.append(widget);
  state.chartKey='hosted|'+symbol+'|'+interval;
  state.candleSource={
   symbol:p.s,source:p.type==='forex'?
    'TradingView hosted FX chart · separate indicative provider':
    'TradingView hosted Binance spot chart · not futures',
   instrument:'hosted_reference'
  };
  $('mc-chart-updated').textContent='TradingView hosted · internal indicators unavailable';
  renderQuote();
  $('mc-chart-loading').hidden=true;
 }catch{
  if(id!==state.loadId)return;
  $('mc-chart-loading').textContent='No historical chart provider is available for this pair. Try another market.';
  $('mc-chart-updated').textContent='All chart feeds unavailable';
 }
}

async function loadCandles(){
 const symbol=state.symbol,interval=state.interval,p=lookup[symbol],id=++state.loadId;
 state.abort?.abort();state.abort=new AbortController();
 $('mc-chart-loading').textContent='Loading '+p.label+' candlesticks…';$('mc-chart-loading').hidden=false;
 state.bars=[];showIndicators();
 try{
  const url='/api/candles?market='+p.type+'&symbol='+encodeURIComponent(symbol)+'&interval='+interval;
  const res=await fetch(url,{cache:'no-store',signal:state.abort.signal});if(!res.ok)throw Error('Historical candles unavailable ('+res.status+'). Try another pair or refresh.');
  const data=await res.json();if(id!==state.loadId)return;
   if(typeof data.source!=='string'||!data.source)throw Error('Candle source is not identified');
  const validBars=(data.candles||[]).filter(b=>[b.time,b.open,b.high,b.low,b.close].every(valid)).map(b=>({time:n(b.time),open:n(b.open),high:n(b.high),low:n(b.low),close:n(b.close),volume:n(b.volume)||0})).sort((a,b)=>a.time-b.time);
  const unique=[];for(const bar of validBars){if(unique.at(-1)?.time===bar.time)unique[unique.length-1]=bar;else unique.push(bar)}
  if(unique.length<12)throw Error('Insufficient candle history for this period');
  const key=symbol+'|'+interval,same=state.chartKey===key&&(state.chart||state.chartEngine);
  const range=state.chart?.timeScale?.().getVisibleLogicalRange?.()||null,follow=range?range.to>=state.bars.length-7:true;
  state.bars=unique;state.candleSource={symbol,source:data.source,instrument:data.instrument||null};
   const latest=unique.at(-1),latestAt=new Date(latest.time*1000).toISOString();
   const existing=state.quotes[symbol];
   if(!(p.type==='forex'&&existing?.reference===true&&
        (data.historicalOnly||Date.parse(existing.asof)>=latest.time*1000)))
    state.quotes[symbol]={price:latest.close,asof:latestAt,source:data.source,
     stale:!!data.historicalOnly||Date.now()-latest.time*1000>180000};
   showIndicators();renderQuote();
  if(same&&state.chart&&state.candleSeries){
   state.candleSeries.setData(unique.map(({time,open,high,low,close})=>({time,open,high,low,close})));
   state.volumeSeries?.setData(unique.map(b=>({time:b.time,value:b.volume||0,color:b.close>=b.open?'#2d6845':'#784246'})));
   [20,50].forEach((period,i)=>state.chartLines[i]?.setData(ema(unique,period)));
   if(range&&!follow)state.chart.timeScale().setVisibleLogicalRange(range);else state.chart.timeScale().scrollToRealTime();
  }else if(same&&state.chartEngine){state.chartDraw?.()}
  else{clearChart();

  try{const lib=await Promise.race([loadChartLibrary(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Chart library timeout')),5700))]);if(id!==state.loadId)return;renderWithLibrary(lib,unique)}
  catch{if(id!==state.loadId)return;renderFallback(unique)}
  state.chartKey=key;}
  if(id!==state.loadId)return;
  const at=new Date(unique.at(-1).time*1000);
  $('mc-chart-updated').textContent=data.historicalOnly?
   'Historical FX · '+at.toLocaleDateString()+' (broker-clock reference)':
   (data.instrument==='spot_reference'?'USD spot reference · ':data.instrument==='spot'?'Spot OHLC · ':'Candle ')+safeTime(unique.at(-1).time*1000);
  $('mc-chart-loading').hidden=true;
 }catch(e){if(e.name==='AbortError'||id!==state.loadId)return;
  clearChart();$('mc-chart-loading').hidden=false;
  $('mc-chart-loading').textContent=e.message||'Chart unavailable';
  $('mc-chart-updated').textContent='Direct OHLC source unavailable';showIndicators();
  await renderHostedChart(p,interval,id);
 }
}
function select(s){
 if(!lookup[s])return;
 state.symbol=s;state.candleSource=null;const p=lookup[s];window.SignalChartFeed?.select(s,state.interval);
 const url=new URL(location.href);url.searchParams.set('pair',s);history.replaceState({},'',url);
 renderWatch();renderQuote();loadCandles();
}
function zoomChart(factor){
 if(state.chart){const ts=state.chart.timeScale(),r=ts.getVisibleLogicalRange();if(!r)return;const m=(r.from+r.to)/2,w=Math.max(10,Math.min(state.bars.length+5,(r.to-r.from)*factor));ts.setVisibleLogicalRange({from:m-w/2,to:m+w/2})}
 else state.chartEngine?.zoom(factor,$('mc-chart').getBoundingClientRect().width/2)
}
function chartLatest(){
 if(state.chart)state.chart.timeScale().setVisibleLogicalRange({from:Math.max(0,state.bars.length-76),to:state.bars.length+3});
 else state.chartEngine?.reset()
}
function bind(){
 $('mc-search').addEventListener('input',e=>{state.search=e.target.value.toLowerCase().trim();state.visibleCount=24;renderWatch()});
 document.addEventListener('click',e=>{
  const s=e.target.closest('[data-mc-symbol]');if(s){select(s.dataset.mcSymbol);return}
   const more=e.target.closest('[data-mc-more]');if(more){state.visibleCount+=48;renderWatch();return}
  const filter=e.target.closest('[data-mc-filter]');if(filter){state.filter=filter.dataset.mcFilter;state.visibleCount=24;document.querySelectorAll('[data-mc-filter]').forEach(b=>b.classList.toggle('active',b===filter));renderWatch();return}
  const interval=e.target.closest('[data-mc-int]');if(interval){state.interval=interval.dataset.mcInt;document.querySelectorAll('[data-mc-int]').forEach(b=>b.classList.toggle('active',b===interval));window.SignalChartFeed?.select(state.symbol,state.interval);loadCandles();return}
 });
 $('mc-chart-refresh').addEventListener('click',()=>{loadCandles();loadQuotes()});$('mc-zoom-in').addEventListener('click',()=>zoomChart(.8));$('mc-zoom-out').addEventListener('click',()=>zoomChart(1.25));$('mc-chart-latest').addEventListener('click',chartLatest);
 $('mc-indicators').addEventListener('click',()=>{state.ema=!state.ema;const btn=$('mc-indicators');btn.classList.toggle('active',state.ema);btn.setAttribute('aria-pressed',String(state.ema));for(const line of state.chartLines)line.applyOptions({visible:state.ema});state.chartEngine?.setIndicators(state.ema);state.chartDraw?.()});
}
async function expandCatalog(){
 try{
  // Cloudflare public market metadata, not the old Vercel quotes catalog.
  const r=await fetch('/api/markets',{cache:'no-store'});
  if(!r.ok)throw Error('Market directory temporarily unavailable');
  const d=await r.json();
  if(!Array.isArray(d.markets))throw Error('Invalid market directory');
  for(const m of d.markets){
   if(!m||!['crypto','forex'].includes(m.type)||
      !/^[A-Z0-9]{6,24}$/.test(String(m.symbol||''))||
      !/^[A-Z0-9]{1,16}$/.test(String(m.base||''))||
      !/^[A-Z0-9]{3,6}$/.test(String(m.quote||''))||lookup[m.symbol])continue;
   const digits=m.type==='forex'?(m.quote==='JPY'?3:5):m.base==='BTC'?2:4;
   const x={s:m.symbol,label:m.base+' / '+m.quote,short:m.base,
    base:m.base,quote:m.quote,icon:m.base.charAt(0),
    type:m.type,d:digits,instrument:m.instrument||'unverified'};
   lookup[x.s]=x;pairs.push(x);
  }
  state.catalogCount=pairs.length;
  state.catalogSource=String(d.source||'Exchange metadata');
  renderWatch();renderTable();
  if(q&&lookup[q]&&state.symbol!==q)select(q);
 }catch{
  const status=$('mc-market-connect');
  if(status)status.lastChild.textContent=' Limited list — market directory unavailable';
 }
}
let tickRender=0,barRender=0;
window.addEventListener('signalchart:tick',e=>{
 for(const [symbol,q]of Object.entries(e.detail?.updates||{}))if(lookup[symbol])state.quotes[symbol]=q;
 if((e.detail?.updates||{})[state.symbol])renderQuote();
 if(Date.now()-tickRender>9000&&!document.hidden){tickRender=Date.now();renderWatch()}
});
window.addEventListener('signalchart:kline',e=>{
 const {symbol,interval,candle,eventTime}=e.detail||{};
 if(symbol!==state.symbol||interval!==state.interval||!candle||!state.bars.length||
    state.candleSource?.instrument!=='perpetual')return;
 const last=state.bars.at(-1);
 if(candle.time===last.time)state.bars[state.bars.length-1]=candle;
 else if(candle.time>last.time){state.bars.push(candle);if(state.bars.length>240)state.bars.shift()}
 else return;
 state.quotes[symbol]={...(state.quotes[symbol]||{}),price:candle.close,asof:new Date(eventTime||Date.now()).toISOString(),stale:false};
 if(Date.now()-barRender>180){
  barRender=Date.now();
  try{state.candleSeries?.update({time:candle.time,open:candle.open,high:candle.high,low:candle.low,close:candle.close})}catch{}
  state.chartDraw?.();renderQuote();$('mc-chart-updated').textContent='LIVE · '+new Date(eventTime||Date.now()).toLocaleTimeString();
 }
});

bind();select(state.symbol);expandCatalog();loadQuotes();
// Do not continually re-request expired FX/provider errors or repaint an
// 80-row table; true history is refreshed only when visible and selected.
setInterval(()=>{if(!document.hidden)loadQuotes()},900000);
setInterval(()=>{if(!document.hidden&&state.bars.length&&
 (lookup[state.symbol].type==='forex'||!window.SignalChartFeed?.state.connected))loadCandles()},180000);
})();