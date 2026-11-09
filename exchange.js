(()=>{'use strict';
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const PAIRS=[
{symbol:'BTCUSDT',label:'BTC/USDT',icon:'₿',type:'crypto',market:'Futures',priceDigits:2,qtyDigits:4},
{symbol:'ETHUSDT',label:'ETH/USDT',icon:'Ξ',type:'crypto',market:'Futures',priceDigits:2,qtyDigits:4},
{symbol:'SOLUSDT',label:'SOL/USDT',icon:'S',type:'crypto',market:'Futures',priceDigits:3,qtyDigits:3},
{symbol:'XRPUSDT',label:'XRP/USDT',icon:'X',type:'crypto',market:'Futures',priceDigits:5,qtyDigits:0},
{symbol:'DOGEUSDT',label:'DOGE/USDT',icon:'Ð',type:'crypto',market:'Futures',priceDigits:6,qtyDigits:0},
{symbol:'EURUSD',label:'EUR/USD',icon:'€',type:'forex',market:'FX',priceDigits:5,qtyDigits:2},
{symbol:'GBPUSD',label:'GBP/USD',icon:'£',type:'forex',market:'FX',priceDigits:5,qtyDigits:2},
{symbol:'USDJPY',label:'USD/JPY',icon:'¥',type:'forex',market:'FX',priceDigits:3,qtyDigits:2}
];const MAP=Object.fromEntries(PAIRS.map(x=>[x.symbol,x]));
const state={selected:'BTCUSDT',interval:'15m',filter:'all',query:'',direction:'long',quote:{},details:null,candles:[],bookTab:'book',bottomTab:'markets',chart:null,emaLines:[],volume:null,showEma:true,chartToken:0,depthToken:0,selectedModal:0,modalResults:[],loadingLibrary:null,chartSource:null,canvasChart:null,savedPlans:[],alerts:[]};
try{const u=new URL(location.href);if(MAP[u.searchParams.get('pair')])state.selected=u.searchParams.get('pair');const plans=JSON.parse(localStorage.getItem('candriva-trade-plans-v1')||'[]');if(Array.isArray(plans))state.savedPlans=plans.slice(0,35);const savedAlerts=JSON.parse(localStorage.getItem('candriva-price-alerts-v2')||'[]');if(Array.isArray(savedAlerts))state.alerts=savedAlerts.slice(0,35)}catch{}
const isFx=()=>MAP[state.selected].type==='forex';
const n=v=>Number(v);
const fmt=(value,digits=2)=>Number.isFinite(n(value))&&value!==null&&value!==''?n(value).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
const compact=value=>Number.isFinite(n(value))?(Math.abs(value)>=1e9?fmt(value/1e9,2)+'B':Math.abs(value)>=1e6?fmt(value/1e6,2)+'M':Math.abs(value)>=1e3?fmt(value/1e3,2)+'K':fmt(value,2)):'—';
const money=value=>'$'+fmt(value,2);
const selectedPair=()=>MAP[state.selected];
const freshness=q=>{if(!q?.asof)return false;const t=Date.parse(q.asof);return Number.isFinite(t)&&Date.now()-t<(isFx()?20*60*1000:180000)};
const timeOf=t=>{const d=new Date(t);return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'})};
const numOrNull=value=>value===null||value===undefined||value===''?null:(Number.isFinite(n(value))?n(value):null);
const source=(sym)=>MAP[sym].type==='crypto'?'Binance Futures':'Indicative FX';
const colorChange=(el,value)=>{el?.classList.remove('up','down');if(Number.isFinite(n(value))&&value!==null)el?.classList.add(n(value)<0?'down':'up')};
function flash(text,error=false){const wrap=$('#toast-holder'),m=document.createElement('div');m.className='toast'+(error?' error':'');m.textContent=text;wrap.append(m);setTimeout(()=>m.remove(),4500)}
function iconClose(){return '<svg><use href="#ic-close"/></svg>'}
function currentQuote(){const q=state.quote[state.selected];return q&&n(q.price)>0?q:null}
function labelSource(){return isFx()?'Indicative FX chart prices':'Binance USDⓈ-M Futures'}
function renderWatch(){
 const q=state.query.toLowerCase().trim(),rows=PAIRS.filter(p=>(state.filter==='all'||p.type===state.filter)&&(!q||(p.label+' '+p.symbol).toLowerCase().includes(q)));
 const container=$('#watch-list');container.replaceChildren();
 let last='';
 for(const p of rows){
  if(p.type!==last){last=p.type;const group=document.createElement('div');group.className='watch-group';group.textContent=p.type==='crypto'?'DIGITAL ASSETS':'FOREX PAIRS';container.append(group)}
  const quote=state.quote[p.symbol],change=state.details?.symbol===p.symbol?state.details.stats?.changePercent:null;
  const b=document.createElement('button');b.type='button';b.dataset.symbol=p.symbol;b.className='watch-item'+(state.selected===p.symbol?' selected':'');
  const left=document.createElement('span');const label=document.createElement('strong');label.textContent=p.label;const sub=document.createElement('small');sub.textContent=p.market==='FX'?'Indicative FX':'USDⓈ-M futures';left.append(label,sub);
  const right=document.createElement('span');const rate=document.createElement('span');rate.className='price';rate.textContent=fmt(quote?.price,p.priceDigits);const ch=document.createElement('span');ch.className='change';ch.textContent=change===null||change===undefined?(quote?(Date.now()-Date.parse(quote.asof)<(p.type==='forex'?20*60*1000:3*60*1000)?'LIVE':'DELAYED'):'NO FEED'):(change>=0?'+':'')+fmt(change,2)+'%';colorChange(ch,change);right.append(rate,ch);b.append(left,right);container.append(b)
 }
 if(!rows.length){const x=document.createElement('p');x.className='depth-empty';x.textContent='No matching markets.';container.append(x)}
}
function renderTable(){
 const body=$('#market-rows');body.replaceChildren();
 for(const p of PAIRS){
  const q=state.quote[p.symbol];const tr=document.createElement('tr');
  const fresh=q?.asof&&Date.now()-Date.parse(q.asof)<(p.type==='forex'?20*60*1000:3*60*1000);const feed=q?(fresh?'LIVE':'DELAYED'):'UNAVAILABLE';const columns=[[p.label,p.market==='FX'?'Indicative':p.market],p.type==='forex'?'Forex':'Crypto',fmt(q?.price,p.priceDigits),feed,source(p.symbol)];
  for(let i=0;i<columns.length;i++){const td=document.createElement('td');
   if(i===0){const title=document.createElement('strong');title.textContent=columns[i][0];const small=document.createElement('small');small.textContent=columns[i][1];td.append(title,small)}
   else{td.textContent=columns[i];if(i===2||i===3)td.className='mono';if(i===3){td.className='mono';td.style.color=feed==='LIVE'?'#90ddad':feed==='DELAYED'?'#e7c38f':'#81929e'}}
   tr.append(td)}
  const action=document.createElement('td');const button=document.createElement('button');button.type='button';button.dataset.symbol=p.symbol;button.textContent='VIEW';action.append(button);tr.append(action);body.append(tr);
 }
}
function renderHero(){
 const p=selectedPair(),q=currentQuote(),stats=state.details?.symbol===p.symbol?state.details.stats:null;
 $('#hero-symbol').textContent=p.label;$('#symbol-icon').textContent=p.icon;$('#symbol-icon').classList.toggle('fx',isFx());
 $('#hero-type').textContent=isFx()?'Indicative forex':'USDⓈ-M Futures';$('#chart-market-tag').textContent=p.label;$('#chart-source').textContent=isFx()?'FX / indicative':'Binance USDⓈ-M';
 $('#hero-price').textContent=fmt(q?.price,p.priceDigits);$('#hero-price-source').textContent=q?(freshness(q)?'Latest quote · '+timeOf(q.asof):'Delayed quote · '+timeOf(q.asof)):'Awaiting market data';
 $('#change-label').textContent=isFx()?'Candle change':'24h change';$('#high-label').textContent=isFx()?'Chart high':'24h high';$('#low-label').textContent=isFx()?'Chart low':'24h low';$('#volume-label').textContent=isFx()?'Market source':'24h turnover';
 if(!isFx()){
 const c=stats?.changePercent;$('#hero-change').textContent=c==null?'—':(c>=0?'+':'')+fmt(c,2)+'%';colorChange($('#hero-change'),c);
 $('#hero-high').textContent=fmt(stats?.high,p.priceDigits);$('#hero-low').textContent=fmt(stats?.low,p.priceDigits);$('#hero-volume').textContent=stats?.volume!=null?'$'+compact(stats.volume):'—';
 }else{
 const b=state.candles,last=b.at(-1),prev=b.at(-2),change=last&&prev?.close>0?(last.close/prev.close-1)*100:null;
 $('#hero-change').textContent=change==null?'—':(change>=0?'+':'')+fmt(change,3)+'%';colorChange($('#hero-change'),change);
 $('#hero-high').textContent=b.length?fmt(Math.max(...b.map(x=>x.high)),p.priceDigits):'—';
 $('#hero-low').textContent=b.length?fmt(Math.min(...b.map(x=>x.low)),p.priceDigits):'—';$('#hero-volume').textContent='Indicative';
 }
 $('#feed-led').classList.toggle('stale',!q||!freshness(q));$('#feed-name').textContent=!q?'FEED CONNECTING':freshness(q)?'DATA CONNECTED':'DELAYED FEED';
 const link=$('#signal-go');link.href=isFx()?'/forex.html':'/crypto.html';link.firstChild.textContent=isFx()?'Open Forex Signals ':'Open Crypto Signals ';
}
async function pullQuotes(){
 const data=await Promise.allSettled(['crypto','forex'].map(m=>fetch('/api/quotes?market='+m,{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(Error('Quote feed unavailable')))));
 for(const result of data)if(result.status==='fulfilled')for(const [symbol,v] of Object.entries(result.value.quotes||{})){if(MAP[symbol]&&n(v.price)>0)state.quote[symbol]=v}
 renderHero();renderWatch();renderTable();checkAlerts();
 const p=currentQuote();if(p&&!$('#plan-entry').dataset.dirty)$('#plan-entry').value=n(p.price).toFixed(selectedPair().priceDigits);calculatePlan();
}
async function pullMarketDetail(){
 const symbol=state.selected,token=++state.depthToken;
 if(MAP[symbol].type!=='crypto'){state.details=null;renderDepth();renderHero();return}
 try{
 const r=await fetch('/api/market-detail?symbol='+encodeURIComponent(symbol),{cache:'no-store'});
 if(!r.ok)throw Error('Order book temporarily unavailable');const data=await r.json();
 if(token!==state.depthToken||state.selected!==symbol)return;
 state.details=data;
 }catch(e){if(token!==state.depthToken)return;state.details=null}
 renderDepth();renderHero();renderWatch();renderTable();
}
function depthRow(price,qty,total,max,kind){const d=document.createElement('div');d.className='depth-row '+kind;
 const bar=document.createElement('div');bar.className='row-bar';bar.style.width=Math.max(1,Math.min(100,qty/max*100))+'%';
 const s1=document.createElement('span');s1.textContent=fmt(price,selectedPair().priceDigits);
 const s2=document.createElement('span');s2.textContent=fmt(qty,selectedPair().qtyDigits);
 const s3=document.createElement('span');s3.textContent=compact(total);
 d.append(bar,s1,s2,s3);d.dataset.price=String(price);d.title='Set planner entry price';return d}
function renderDepth(){
 const fx=isFx();
 $('#fx-depth').hidden=!fx;
 $('#book-view').hidden=fx||state.bookTab!=='book';
 $('#trades-view').hidden=fx||state.bookTab!=='trades';
 $('#depth-tab').disabled=fx;$('#trades-tab').disabled=fx;
 if(fx)return;
 const depth=state.details?.depth,asksEl=$('#ask-list'),bidsEl=$('#bid-list');asksEl.replaceChildren();bidsEl.replaceChildren();
 if(!depth?.asks?.length||!depth?.bids?.length){const m=document.createElement('p');m.className='depth-empty';m.textContent='Live Binance order book unavailable. Retrying automatically.';asksEl.append(m);$('#depth-mid').textContent=fmt(currentQuote()?.price,selectedPair().priceDigits);$('#depth-spread').textContent='Spread —'}
 else{
 const asks=depth.asks.slice(0,12).reverse(),bids=depth.bids.slice(0,12);
 const max=Math.max(0.0000001,...asks.map(x=>x[1]),...bids.map(x=>x[1]));
 for(const [p,q]of asks)asksEl.append(depthRow(p,q,p*q,max,'ask'));
 for(const [p,q]of bids)bidsEl.append(depthRow(p,q,p*q,max,'bid'));
 const a=n(depth.asks[0][0]),b=n(depth.bids[0][0]),spread=a-b;
 $('#depth-mid').textContent=fmt((a+b)/2,selectedPair().priceDigits);
 $('#depth-spread').textContent='Spread '+fmt(spread,selectedPair().priceDigits);
 }
 $('#depth-updated').textContent=state.details?.asof?timeOf(state.details.asof):'—';
 const tradeList=$('#trades-list');tradeList.replaceChildren();
 const trades=state.details?.trades;
 if(!trades?.length){const p=document.createElement('p');p.className='depth-empty';p.textContent='Recent exchange trades unavailable.';tradeList.append(p)}
 else for(const t of trades){const row=document.createElement('div');row.className='depth-row '+(t.side==='buy'?'bid':'ask');
 for(const [i,value] of [fmt(t.price,selectedPair().priceDigits),fmt(t.qty,selectedPair().qtyDigits),timeOf(t.time)].entries()){const s=document.createElement('span');s.textContent=value;row.append(s)}
 tradeList.append(row)}
}
let libPromise;
function loadLibrary(){
 if(window.LightweightCharts)return Promise.resolve(window.LightweightCharts);
 if(libPromise)return libPromise;
 libPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';script.onload=()=>window.LightweightCharts?resolve(window.LightweightCharts):reject(Error('Chart module unavailable'));script.onerror=()=>reject(Error('Chart module could not load'));document.head.append(script)});
 return libPromise;
}
function emaBars(bars,period){const k=2/(period+1);let v=bars[0]?.close||0;return bars.map((b,i)=>{v=i===0?b.close:b.close*k+v*(1-k);return{time:b.time,value:v}})}
function rsiOf(bars){if(bars.length<16)return null;const closes=bars.slice(-15).map(b=>b.close);let gain=0,loss=0;for(let i=1;i<closes.length;i++){const diff=closes[i]-closes[i-1];gain+=Math.max(0,diff);loss+=Math.max(0,-diff)}if(loss===0)return gain===0?50:100;return 100-100/(1+(gain/loss))}
let resizeObserver=null;
function clearChart(){
 if(resizeObserver){resizeObserver.disconnect();resizeObserver=null}
 if(state.chart){try{state.chart.remove()}catch{}state.chart=null}
 $('#chart-area').replaceChildren();
 state.canvasChart=null;state.emaLines=[];state.volume=null;
}
function attachChart(lib,bars){
 const root=$('#chart-area'),dark='#10161e',w=Math.max(320,root.clientWidth),h=Math.max(320,root.clientHeight);
 const chart=lib.createChart(root,{width:w,height:h,layout:{background:{type:'solid',color:dark},textColor:'#9babb3',fontSize:11,fontFamily:'IBM Plex Mono,monospace'},grid:{vertLines:{color:'#252f39'},horzLines:{color:'#252f39'}},crosshair:{mode:lib.CrosshairMode.Normal,vertLine:{labelBackgroundColor:'#455248'},horzLine:{labelBackgroundColor:'#455248'}},rightPriceScale:{borderColor:'#36414a',scaleMargins:{top:0.10,bottom:0.22}},timeScale:{borderColor:'#36414a',timeVisible:true,secondsVisible:false,rightOffset:6},handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false}});
 state.chart=chart;
 const candles=chart.addCandlestickSeries({upColor:'#75dba8',downColor:'#e98a98',borderVisible:false,wickUpColor:'#75dba8',wickDownColor:'#e98a98',priceLineVisible:true});
 candles.setData(bars.map(({time,open,high,low,close})=>({time,open,high,low,close})));
 const volume=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'',lastValueVisible:false,priceLineVisible:false});
 volume.priceScale().applyOptions({scaleMargins:{top:0.81,bottom:0}});
 volume.setData(bars.map(b=>({time:b.time,value:n(b.volume)||0,color:b.close>=b.open?'#2d5d4e':'#633844'})));state.volume=volume;
 const lines=[[20,'#b9e88f'],[50,'#b79cda']];
 for(const [period,color]of lines){const s=chart.addLineSeries({color,lineWidth:2,priceLineVisible:false,lastValueVisible:false,visible:state.showEma});s.setData(emaBars(bars,period));state.emaLines.push(s)}
 chart.timeScale().fitContent();
 if(window.ResizeObserver){resizeObserver=new ResizeObserver(()=>{if(!state.chart)return;try{chart.applyOptions({width:Math.max(1,root.clientWidth),height:Math.max(1,root.clientHeight)})}catch{}});resizeObserver.observe(root)}
}
function fallbackChart(bars){
 const root=$('#chart-area');const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Candlestick chart from actual market data');canvas.style.cssText='display:block;width:100%;height:100%';root.append(canvas);state.canvasChart=canvas;
 const draw=()=>{
  if(!canvas.isConnected||!bars.length)return;
  const rect=canvas.getBoundingClientRect(),w=Math.max(300,rect.width),h=Math.max(280,rect.height),dpr=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  const sample=bars.slice(-65),hi=Math.max(...sample.map(b=>b.high)),lo=Math.min(...sample.map(b=>b.low)),diff=Math.max((hi-lo)*1.15,1e-12),chartH=h-64,chartW=w-79,left=12,top=20;
  const yy=v=>top+(hi+(hi-lo)*0.08-v)/diff*chartH,xx=i=>left+(i+.5)*chartW/sample.length;
  ctx.font='10px monospace';for(let i=0;i<=4;i++){const y=top+(chartH*i/4);ctx.strokeStyle='#28343e';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w-65,y);ctx.stroke();ctx.fillStyle='#8b9ca5';ctx.fillText(fmt(hi-i/4*(hi-lo),selectedPair().priceDigits),w-60,y+3)}
  const bw=Math.max(2,(chartW/sample.length)*.5),volMax=Math.max(1,...sample.map(b=>n(b.volume)||0));
  sample.forEach((b,i)=>{const x=xx(i),up=b.close>=b.open;ctx.strokeStyle=up?'#75dba8':'#e98a98';ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(x,yy(b.high));ctx.lineTo(x,yy(b.low));ctx.stroke();ctx.fillRect(x-bw/2,Math.min(yy(b.open),yy(b.close)),bw,Math.max(1,Math.abs(yy(b.open)-yy(b.close))));ctx.fillStyle=up?'#2d5d4e':'#633844';ctx.fillRect(x-bw/2,h-26-(n(b.volume)||0)/volMax*21,bw,(n(b.volume)||0)/volMax*21)});
  if(state.showEma)for(const [period,color]of[[20,'#b9e88f'],[50,'#b79cda']]){const full=emaBars(bars,period).slice(-sample.length);ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();full.forEach((b,i)=>i===0?ctx.moveTo(xx(i),yy(b.value)):ctx.lineTo(xx(i),yy(b.value)));ctx.stroke();ctx.lineWidth=1}
 };
 draw();window.addEventListener('resize',draw);
}
async function pullCandles(){
 const symbol=state.selected,interval=state.interval,token=++state.chartToken;
 $('#chart-loading').textContent='Loading '+selectedPair().label+' candles…';$('#chart-loading').hidden=false;
 try{
 const res=await fetch((interval==='1d'?'/api/market-detail?symbol='+encodeURIComponent(symbol)+'&interval=1d':'/api/candles?market='+(MAP[symbol].type==='forex'?'forex':'crypto')+'&symbol='+encodeURIComponent(symbol)+'&interval='+encodeURIComponent(interval)),{cache:'no-store'});
 if(!res.ok)throw Error('Candle feed unavailable');const data=await res.json();
 if(token!==state.chartToken||symbol!==state.selected)return;
 const bars=(data.candles||[]).filter(b=>[b.time,b.open,b.high,b.low,b.close].every(x=>Number.isFinite(Number(x)))).map(b=>({time:Number(b.time),open:n(b.open),high:n(b.high),low:n(b.low),close:n(b.close),volume:n(b.volume)||0})).sort((a,b)=>a.time-b.time);
 if(bars.length<10)throw Error('Not enough market candles for this timeframe');
 state.candles=bars;state.chartSource=data.source||labelSource();
 clearChart();
 try{const lib=await Promise.race([loadLibrary(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Chart library timeout')),6500))]);if(token!==state.chartToken)return;attachChart(lib,bars)}
 catch{if(token!==state.chartToken)return;fallbackChart(bars)}
 if(token!==state.chartToken)return;
 $('#chart-loading').hidden=true;$('#chart-asof').textContent='Last candle '+timeOf(bars.at(-1).time*1000);
 updateAnalysis();renderHero();calculatePlan();
 }catch(e){if(token!==state.chartToken)return;$('#chart-loading').textContent=e.message||'Price chart unavailable';state.candles=[];updateAnalysis();renderHero()}
}
function updateAnalysis(){
 const bars=state.candles,p=selectedPair();for(const s of ['#analysis-ema20','#analysis-ema50','#analysis-rsi','#analysis-trend','#analysis-range'])$(s).textContent='—';
 if(!bars.length)return;
 const e20=emaBars(bars,20).at(-1).value,e50=emaBars(bars,50).at(-1).value,rsi=rsiOf(bars),last=bars.at(-1).close;
 $('#analysis-ema20').textContent=fmt(e20,p.priceDigits);$('#analysis-ema50').textContent=fmt(e50,p.priceDigits);
 $('#analysis-rsi').textContent=rsi===null?'—':fmt(rsi,2);
 $('#analysis-trend').textContent=last>=e20?'Above EMA 20':'Below EMA 20';
 $('#analysis-range').textContent=fmt(Math.min(...bars.slice(-24).map(b=>b.low)),p.priceDigits)+' – '+fmt(Math.max(...bars.slice(-24).map(b=>b.high)),p.priceDigits);
}
function selectSymbol(symbol){
 if(!MAP[symbol])return;
 state.selected=symbol;state.details=null;state.candles=[];state.depthToken++;
 $('#plan-entry').dataset.dirty='';$('#plan-entry').value='';
 renderHero();renderWatch();renderTable();renderDepth();updateAnalysis();$('#alert-symbol').textContent=MAP[symbol].label;$('#alert-level').value='';
 
 const url=new URL(location.href);url.searchParams.set('pair',symbol);history.replaceState(null,'',url);
 pullMarketDetail();pullCandles();closeModal();
 const q=currentQuote();if(q)$('#plan-entry').value=n(q.price).toFixed(selectedPair().priceDigits);calculatePlan();
}
function calculatePlan(){
 const entry=n($('#plan-entry').value),capital=n($('#plan-capital').value),risk=n($('#plan-risk').value),stopPct=n($('#plan-stop').value),rr=n($('#plan-rr').value);
 if(!(entry>0&&capital>0&&risk>0&&stopPct>0&&rr>0)){for(const s of ['#risk-output','#notional-output','#stop-output','#target-output'])$(s).textContent='—';return null}
 const riskValue=capital*risk/100,notional=riskValue/(stopPct/100);
 const side=state.direction==='long'?1:-1;
 const stop=entry*(1-side*stopPct/100),target=entry*(1+side*stopPct/100*rr);
 const p={symbol:state.selected,direction:state.direction,entry,stop,target,riskValue,notional,rr,account:capital,risk,stopPct,createdAt:new Date().toISOString()};
 $('#risk-output').textContent=money(riskValue);$('#notional-output').textContent='≈ '+money(notional);
 $('#stop-output').textContent=fmt(stop,selectedPair().priceDigits);$('#target-output').textContent=fmt(target,selectedPair().priceDigits);
 return p;
}
function storePlans(){try{localStorage.setItem('candriva-trade-plans-v1',JSON.stringify(state.savedPlans))}catch{flash('Could not save to this device',true)}}
function renderPlans(){
 $('#plan-count').textContent=state.savedPlans.length?'('+state.savedPlans.length+')':'';
 const el=$('#saved-plans');el.replaceChildren();
 if(!state.savedPlans.length){el.textContent='No trade plans saved on this device.';return}
 for(const [i,p] of state.savedPlans.entries()){
  const row=document.createElement('div');row.className='saved-plan';const body=document.createElement('span');const title=document.createElement('strong');title.textContent=(MAP[p.symbol]?.label||p.symbol)+' · '+String(p.direction).toUpperCase();const small=document.createElement('small');small.textContent='Entry '+fmt(p.entry,MAP[p.symbol]?.priceDigits||2)+' · Stop '+fmt(p.stop,MAP[p.symbol]?.priceDigits||2)+' · Target '+fmt(p.target,MAP[p.symbol]?.priceDigits||2);body.append(title,small);const button=document.createElement('button');button.textContent='REMOVE';button.dataset.removePlan=String(i);row.append(body,button);el.append(row)
 }
}

function saveAlerts(){try{localStorage.setItem('candriva-price-alerts-v2',JSON.stringify(state.alerts))}catch{flash('Could not save price alerts on this device',true)}}
function renderAlerts(){
 $('#alert-count').textContent=state.alerts.length?'('+state.alerts.length+')':'';
 const el=$('#alert-list');el.replaceChildren();
 if(!state.alerts.length){const p=document.createElement('p');p.textContent='No saved price alerts yet.';el.append(p);return}
 for(const [i,a] of state.alerts.entries()){
  const item=document.createElement('div');item.className='alert-item';
  const main=document.createElement('span');const strong=document.createElement('strong');
  strong.textContent=(MAP[a.symbol]?.label||a.symbol)+' '+(a.direction==='above'?'above':'below')+' '+fmt(a.target,MAP[a.symbol]?.priceDigits||2);
  const sub=document.createElement('small');sub.textContent=a.fired?'Triggered':'Monitoring while this page is open';main.append(strong,sub);
  const button=document.createElement('button');button.dataset.deleteAlert=String(i);button.type='button';button.textContent='REMOVE';item.append(main,button);el.append(item)
 }
}
function checkAlerts(){
 let modified=false;
 for(const a of state.alerts){
  const q=state.quote[a.symbol],price=n(q?.price);
  if(a.fired||!(price>0))continue;
  const triggered=a.direction==='above'?price>=a.target:price<=a.target;
  if(!triggered)continue;
  a.fired=true;modified=true;
  const label=MAP[a.symbol]?.label||a.symbol;
  const message=label+' '+(a.direction==='above'?'rose above':'fell below')+' '+fmt(a.target,MAP[a.symbol]?.priceDigits||2);
  flash(message);
  if('Notification'in window&&Notification.permission==='granted'){try{new Notification('Candriva price alert',{body:message})}catch{}}
 }
 if(modified){saveAlerts();renderAlerts()}
}
function changeBottom(target){state.bottomTab=target;$$('[data-bottom]').forEach(b=>{const selected=b.dataset.bottom===target;b.classList.toggle('selected',selected);b.setAttribute('aria-selected',String(selected))});for(const name of ['markets','analysis','plans','alerts'])$('#bottom-'+name).hidden=name!==target}
function changeBook(target){state.bookTab=target;$$('[data-depth-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.depthTab===target));renderDepth()}
function openModal(query=''){
 $('#symbol-modal').hidden=false;$('#modal-query').value=query;renderModal();requestAnimationFrame(()=>$('#modal-query').focus());
}
function closeModal(){$('#symbol-modal').hidden=true;}
function renderModal(){
 const query=$('#modal-query').value.toLowerCase().trim(),matches=PAIRS.filter(p=>(p.label+p.symbol+p.market).toLowerCase().includes(query));
 state.modalResults=matches;const root=$('#modal-results');root.replaceChildren();
 for(const [i,p] of matches.entries()){
 const row=document.createElement('button');row.type='button';row.className='modal-option'+(i===state.selectedModal?' chosen':'');row.dataset.modalSymbol=p.symbol;const icon=document.createElement('span');icon.className='pair-icon'+(p.type==='forex'?' fx':'');icon.textContent=p.icon;icon.style.cssText='width:28px;height:28px;font-size:16px';const title=document.createElement('strong');title.textContent=p.label;const sub=document.createElement('small');sub.textContent=p.type==='forex'?'FOREX':'CRYPTO';row.append(icon,title,sub);root.append(row)
 }
 if(!matches.length){const p=document.createElement('p');p.className='depth-empty';p.textContent='No markets found.';root.append(p)}
}
function bind(){
 document.addEventListener('click',e=>{
  const symbol=e.target.closest('[data-symbol]');if(symbol){selectSymbol(symbol.dataset.symbol);return}
  const price=e.target.closest('.depth-row[data-price]');if(price){$('#plan-entry').value=price.dataset.price;$('#plan-entry').dataset.dirty='yes';calculatePlan();return}
  const period=e.target.closest('[data-interval]');if(period){state.interval=period.dataset.interval;$$('[data-interval]').forEach(b=>b.classList.toggle('selected',b===period));pullCandles();return}
  const filter=e.target.closest('[data-market-filter]');if(filter){state.filter=filter.dataset.marketFilter;$$('[data-market-filter]').forEach(b=>b.classList.toggle('selected',b===filter));renderWatch();return}
  const tab=e.target.closest('[data-depth-tab]');if(tab){changeBook(tab.dataset.depthTab);return}
  const bottom=e.target.closest('[data-bottom]');if(bottom){changeBottom(bottom.dataset.bottom);return}
  const direction=e.target.closest('[data-direction]');if(direction){state.direction=direction.dataset.direction;$$('[data-direction]').forEach(b=>b.classList.toggle('selected',b===direction));calculatePlan();return}
  const modalSymbol=e.target.closest('[data-modal-symbol]');if(modalSymbol){selectSymbol(modalSymbol.dataset.modalSymbol);return}
  const del=e.target.closest('[data-remove-plan]');if(del){state.savedPlans.splice(Number(del.dataset.removePlan),1);storePlans();renderPlans();return}const alertDel=e.target.closest('[data-delete-alert]');if(alertDel){state.alerts.splice(Number(alertDel.dataset.deleteAlert),1);saveAlerts();renderAlerts();return}
  if(e.target.closest('[data-close-modal]'))closeModal();
 });
 $('#cmd-open').onclick=()=>openModal();$('#symbol-open').onclick=()=>openModal();$('#modal-close').onclick=closeModal();$('#menu-open').onclick=()=>openModal();
 $('#watch-query').oninput=e=>{state.query=e.target.value;renderWatch()};
 $('#modal-query').oninput=()=>{state.selectedModal=0;renderModal()};
 $('#modal-query').onkeydown=e=>{
 if(e.key==='ArrowDown'){e.preventDefault();state.selectedModal=Math.min(state.modalResults.length-1,state.selectedModal+1);renderModal()}
 if(e.key==='ArrowUp'){e.preventDefault();state.selectedModal=Math.max(0,state.selectedModal-1);renderModal()}
 if(e.key==='Enter'&&state.modalResults[state.selectedModal]){e.preventDefault();selectSymbol(state.modalResults[state.selectedModal].symbol)}
 };
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openModal()}if(e.key==='Escape')closeModal()});
 $('#refresh-chart').onclick=pullCandles;
 $('#chart-max').onclick=()=>{const app=$('.ex-app'),on=app.classList.toggle('chart-max');$('#chart-max').setAttribute('aria-pressed',String(on));$('#chart-max').title=on?'Restore chart':'Expand chart';if(state.chart)setTimeout(()=>state.chart.applyOptions({width:$('#chart-area').clientWidth,height:$('#chart-area').clientHeight}),80)};
 $('#indicators-toggle').onclick=()=>{state.showEma=!state.showEma;$('#indicators-toggle').classList.toggle('off',!state.showEma);$('#indicators-toggle').setAttribute('aria-pressed',String(state.showEma));for(const l of state.emaLines)l.applyOptions({visible:state.showEma});if(state.canvasChart)pullCandles()};
 for(const field of ['#plan-entry','#plan-capital','#plan-risk','#plan-stop','#plan-rr'])$(field).addEventListener('input',()=>{if(field==='#plan-entry')$('#plan-entry').dataset.dirty='yes';calculatePlan()});
 
 $('#alert-level').addEventListener('input',e=>e.target.dataset.dirty='1');
 $('#alert-form').onsubmit=e=>{
  e.preventDefault();const target=n($('#alert-level').value),symbol=state.selected,direction=$('#alert-direction').value;
  if(!(target>0)||!['above','below'].includes(direction)){flash('Choose a valid price threshold',true);return}
  state.alerts.unshift({id:Date.now()+'-'+Math.round(Math.random()*1000000),symbol,target,direction,createdAt:new Date().toISOString(),fired:false});
  state.alerts=state.alerts.slice(0,35);saveAlerts();renderAlerts();flash('Price alert saved on this device');$('#alert-level').value='';checkAlerts();
 };
 $('#alert-permission').onclick=async()=>{
  if(!('Notification'in window)){flash('Browser notifications are unavailable',true);return}
  const p=await Notification.requestPermission();
  flash(p==='granted'?'Browser notifications enabled':'Notifications permission: '+p,p!=='granted');
 };
$('#trade-plan-form').onsubmit=e=>{e.preventDefault();const p=calculatePlan();if(!p){flash('Enter valid plan parameters',true);return}state.savedPlans.unshift(p);state.savedPlans=state.savedPlans.slice(0,35);storePlans();renderPlans();flash('Trade plan saved to this device');changeBottom('plans')};
 $('#mobile-depth').onclick=()=>{$('#depth-panel').scrollIntoView({behavior:'smooth',block:'start'});changeBook('book')};
}
bind();renderPlans();renderAlerts();renderHero();renderDepth();renderWatch();renderTable();
selectSymbol(state.selected);
pullQuotes();
setInterval(()=>{if(!document.hidden)pullQuotes()},15000);
setInterval(()=>{if(!document.hidden)pullMarketDetail()},10000);
setInterval(()=>{if(!document.hidden)pullCandles()},60000);
})();
