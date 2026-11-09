(()=>{'use strict';
const symbols=[
{symbol:'BTCUSDT',name:'BTC / USDT',short:'BTC',icon:'₿',market:'crypto',source:'Binance USD-M Futures',digits:2},
{symbol:'ETHUSDT',name:'ETH / USDT',short:'ETH',icon:'Ξ',market:'crypto',source:'Binance USD-M Futures',digits:2},
{symbol:'SOLUSDT',name:'SOL / USDT',short:'SOL',icon:'S',market:'crypto',source:'Binance USD-M Futures',digits:3},
{symbol:'XRPUSDT',name:'XRP / USDT',short:'XRP',icon:'X',market:'crypto',source:'Binance USD-M Futures',digits:5},
{symbol:'DOGEUSDT',name:'DOGE / USDT',short:'DOGE',icon:'Ð',market:'crypto',source:'Binance USD-M Futures',digits:6},
{symbol:'EURUSD',name:'EUR / USD',short:'EUR',icon:'€',market:'forex',source:'Indicative FX · Yahoo Finance',digits:5},
{symbol:'GBPUSD',name:'GBP / USD',short:'GBP',icon:'£',market:'forex',source:'Indicative FX · Yahoo Finance',digits:5},
{symbol:'USDJPY',name:'USD / JPY',short:'JPY',icon:'¥',market:'forex',source:'Indicative FX · Yahoo Finance',digits:3}
];
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const bySymbol=Object.fromEntries(symbols.map(x=>[x.symbol,x]));
let active='BTCUSDT',timeframe='15m',quotes={},candles=[],fetchController=null,hover=-1,filter='all',tableFilter='all',commandIndex=0,commandMatches=[],lastChartError='',chartUpdated=null;
const fmt=(s,n)=>{const x=Number(n);return Number.isFinite(x)&&x>0?x.toLocaleString('en-US',{minimumFractionDigits:bySymbol[s]?.digits||2,maximumFractionDigits:bySymbol[s]?.digits||2}):'—'};
const safeDate=s=>{const d=new Date(s);return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'})};
const stale=(s,q)=>!q||!!q.stale||(Date.now()-new Date(q.asof).getTime()>(bySymbol[s].market==='forex'?20*60*1000:3*60*1000));
const icon=id=>'<svg><use href="#'+id+'"></use></svg>';
function clock(){const utc=new Date().toLocaleTimeString('en-GB',{timeZone:'UTC',hour12:false});$('#utc-clock').textContent='UTC '+utc;$('#footer-time').textContent=utc;}
function select(symbol){
 if(!bySymbol[symbol])return;
 active=symbol;hover=-1;
 const ob=bySymbol[symbol];
 $$('[data-market-mode]').forEach(b=>b.classList.toggle('active',b.dataset.marketMode===ob.market));
 $('#chart-pair').textContent=ob.name;$('#context-symbol').textContent=ob.name;$('#chart-source').textContent=ob.source;
 $('#ticker-badge').textContent=ob.icon;$('#ticker-badge').classList.toggle('forex',ob.market==='forex');$('#asset-tag').textContent=ob.market==='crypto'?'CRYPTO':'FOREX';
 const u=new URL(location.href);if(u.pathname==='/terminal.html'){u.searchParams.set('pair',symbol);history.replaceState({},'',u);}
 renderRows();updatePrices();loadCandles();
}
function selectMarket(mode){select(mode==='forex'?'EURUSD':'BTCUSDT');}
function makeRow(s,side=false){
 const ob=bySymbol[s],q=quotes[s],delay=stale(s,q);
 if(side)return '<button class="instrument-row '+(active===s?'active':'')+'" data-symbol="'+s+'" type="button"><span class="symbol-mark '+(ob.market==='forex'?'fx':'crypto')+'">'+ob.icon+'</span><span class="instrument-info"><strong>'+ob.name+'</strong><small>'+ob.short+' · '+(ob.market==='crypto'?'FUTURES':'SPOT FX')+'</small></span><span class="instrument-rate">'+fmt(s,q?.price)+'<small>'+(q?(delay?'DELAYED':'UPDATED'):'NO FEED')+'</small></span></button>';
 return '<tr><td><span class="mkt-strong">'+ob.name+'</span><span class="subline">'+ob.short+' · '+(ob.market==='crypto'?'PERPETUAL':'CURRENCY')+'</span></td><td>'+(ob.market==='crypto'?'CRYPTO':'FOREX')+'</td><td class="mono">'+fmt(s,q?.price)+'</td><td><span class="status '+(delay?'stale':'')+'">'+(q?(delay?'DELAYED':'ACTIVE'):'UNAVAILABLE')+'</span></td><td><button data-symbol="'+s+'">VIEW ↗</button></td></tr>';
}
function renderRows(){
 let parts=[];for(const mode of ['crypto','forex']){const list=symbols.filter(x=>x.market===mode&&(filter==='all'||filter===mode));if(list.length)parts.push('<div class="watch-group">'+(mode==='crypto'?'CRYPTO / 05':'FOREX / 03')+'</div>'+list.map(x=>makeRow(x.symbol,true)).join(''));}
 $('#instrument-list').innerHTML=parts.join('')||'<div class="list-loading">No instruments in this category.</div>';
 $('#market-table-rows').innerHTML=symbols.filter(x=>tableFilter==='all'||x.market===tableFilter).map(x=>makeRow(x.symbol)).join('');
 $$('[data-quote]').forEach(n=>{const s=n.dataset.quote;n.textContent=fmt(s,quotes[s]?.price)});
}
function changeContext(){
 if(!candles.length)return;
 const n=candles.length,last=candles[n-1],prev=candles[n-2];
 const pct=prev?.close>0?(last.close-prev.close)/prev.close*100:null;
 const pSign=pct===null?'':pct>=0?'+':'';
 const pctString=pct==null?'—':pSign+pct.toFixed(2)+'%';
 $('#chart-change').textContent='Last candle '+pctString;$('#chart-change').className=pct===null?'':pct>=0?'up':'down';
 $('#context-change').textContent=pctString;
 const closes=candles.map(x=>x.close);const e20=ema(closes,20),e50=ema(closes,50);
 $('#context-ema20').textContent=fmt(active,e20[e20.length-1]);
 $('#context-ema50').textContent=fmt(active,e50[e50.length-1]);
 const diffs=closes.slice(-15).map((v,i,arr)=>i?v-arr[i-1]:0).slice(1);
 const gain=diffs.reduce((a,x)=>a+Math.max(0,x),0)/diffs.length,loss=diffs.reduce((a,x)=>a+Math.max(0,-x),0)/diffs.length;
 const rsi=loss===0?(gain===0?50:100):100-100/(1+gain/loss);
 $('#context-rsi').textContent=rsi.toFixed(1);
 const recent=candles.slice(-24),rangeLow=Math.min(...recent.map(x=>x.low)),rangeHigh=Math.max(...recent.map(x=>x.high));
 $('#context-range').textContent=fmt(active,rangeLow)+'–'+fmt(active,rangeHigh);
}
function updatePrices(){
 const q=quotes[active];
 const value=fmt(active,q?.price);
 $('#chart-price').textContent=value;$('#context-price').textContent=value;
 const delay=stale(active,q);$('#context-status').textContent=!q?'UNAVAILABLE':delay?'DELAYED':'UPDATED';
 $('#context-time').textContent=q?'Quote '+safeDate(q.asof)+(delay?' · delayed':''):'Awaiting market feed';
 const online=symbols.some(x=>quotes[x.symbol]&&!stale(x.symbol,quotes[x.symbol]));
 $('#connection-dot').classList.toggle('offline',!online);
 $('#connection-state').textContent=online?'DATA CONNECTED':'MARKET FEED';
}
async function getQuotes(market){
 try{const response=await fetch('/api/quotes?market='+market,{cache:'no-store'});if(!response.ok)throw Error('Quote request failed');
 const result=await response.json();for(const [s,q] of Object.entries(result.quotes||{})){if(!bySymbol[s]||!(Number(q.price)>0))continue;quotes[s]={...q,price:Number(q.price)};}renderRows();updatePrices();
 }catch(e){renderRows();updatePrices();}
}
const ema=(arr,period)=>{const k=2/(period+1),values=[];let x=arr[0];for(const n of arr){x=n*k+x*(1-k);values.push(x)}return values;};
async function loadCandles(){
 const s=active,interval=timeframe;
 fetchController?.abort();fetchController=new AbortController();
 $('#chart-fallback').hidden=false;$('#chart-fallback').textContent='Loading '+bySymbol[s].name+' candles…';$('#chart-updated').textContent='Fetching '+interval;
 candles=[];resetContext();
 try{
 const url='/api/candles?market='+bySymbol[s].market+'&symbol='+s+'&interval='+interval;
 const response=await fetch(url,{cache:'no-store',signal:fetchController.signal});if(!response.ok)throw Error('Market candles unavailable');
 const data=await response.json();if(active!==s||timeframe!==interval)return;
 candles=(data.candles||[]).filter(b=>Number.isFinite(b.open)&&Number.isFinite(b.high)&&Number.isFinite(b.low)&&Number.isFinite(b.close)&&Number.isFinite(b.time)).slice(-120);
 if(candles.length<15)throw Error('Insufficient candle history');lastChartError='';chartUpdated=new Date();$('#chart-fallback').hidden=true;
 $('#chart-feed').textContent=data.market==='crypto'?'BINANCE / OHLC':'FX / INDICATIVE';
 $('#chart-updated').textContent='Candle '+safeDate(candles[candles.length-1].time*1000);
 changeContext();draw();
 }catch(e){if(e.name==='AbortError')return;lastChartError=e.message||'Candle feed unavailable';$('#chart-fallback').hidden=false;$('#chart-fallback').textContent=lastChartError;$('#chart-updated').textContent='Data unavailable';}
}
function resetContext(){['#context-change','#context-ema20','#context-ema50','#context-rsi','#context-range'].forEach(k=>$(k).textContent='—');$('#chart-change').textContent='Loading candle data…';$('#ohlc-hover').textContent='';}
function draw(){
 const cv=$('#chart-canvas');if(!cv||!candles.length)return;
 const rect=cv.getBoundingClientRect(),width=Math.max(280,rect.width||640),height=Math.max(190,rect.height||335),dpr=Math.min(2,window.devicePixelRatio||1);
 const w=Math.round(width*dpr),h=Math.round(height*dpr);if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h}
 const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
 const left=18,right=74,top=29,bottom=31,volH=45;const chartW=width-left-right,chartH=height-top-bottom-volH-9;
 const visible=candles.slice(-Math.min(72,candles.length)),count=visible.length;const max=Math.max(...visible.map(x=>x.high)),min=Math.min(...visible.map(x=>x.low));const delta=Math.max(1e-12,max-min),minY=min-delta*.07,maxY=max+delta*.07;
 const Y=value=>top+(maxY-value)/(maxY-minY)*chartH;const X=i=>left+(i+.5)*chartW/count;
 ctx.font='9px "IBM Plex Mono", monospace';ctx.lineWidth=1;ctx.textAlign='left';
 for(let i=0;i<=4;i++){
  const y=top+(chartH*i/4),rate=maxY-(maxY-minY)*i/4;
  ctx.strokeStyle='#394a55a0';ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(width-right+8,y);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#8497a2';ctx.fillText(fmt(active,rate),width-right+13,y+3);
 }
 for(let j=0;j<=6;j++){const x=left+chartW*j/6;ctx.strokeStyle='#33414b70';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+chartH);ctx.stroke()}
 const bodyW=Math.max(2,Math.min(11,(chartW/count)*.57));
 const volMax=Math.max(...visible.map(x=>Number(x.volume)||0),1);
 visible.forEach((c,i)=>{const x=X(i),good=c.close>=c.open,color=good?'#acd984':'#d78a91';ctx.strokeStyle=color;ctx.fillStyle=color;
  ctx.beginPath();ctx.moveTo(x,Y(c.high));ctx.lineTo(x,Y(c.low));ctx.stroke();
  const yOpen=Y(c.open),yClose=Y(c.close);ctx.fillRect(x-bodyW/2,Math.min(yOpen,yClose),bodyW,Math.max(1,Math.abs(yClose-yOpen)));
  const volume=(Number(c.volume)||0)/volMax;ctx.fillStyle=good?'#416751':'#72494f';ctx.fillRect(x-bodyW/2,height-bottom-volume*volH,bodyW,Math.max(1,volume*volH));
 });
 const closes=visible.map(x=>x.close);
 [[20,'#b4e68c'],[50,'#bca0e9']].forEach(([period,color])=>{
 const start=candles.slice(0,-visible.length),all=[...start,...visible].map(x=>x.close);const result=ema(all,period).slice(-visible.length);
 ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=1.6;result.forEach((value,i)=>{if(i===0)ctx.moveTo(X(i),Y(value));else ctx.lineTo(X(i),Y(value))});ctx.stroke();ctx.lineWidth=1;
 });
 for(let j=0;j<=4;j++){const i=Math.round((count-1)*j/4),c=visible[i];if(!c)continue;const dt=new Date(c.time*1000);const label=dt.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+dt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});ctx.fillStyle='#82939f';ctx.font='9px "IBM Plex Mono", monospace';ctx.fillText(label,Math.min(width-95,Math.max(15,X(i)-29)),height-8);}
 if(hover>=0&&hover<count){const i=hover,c=visible[i],x=X(i),y=Y(c.close);
 ctx.strokeStyle='#c2d2c580';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,height-bottom);ctx.moveTo(left,y);ctx.lineTo(width-right+8,y);ctx.stroke();ctx.setLineDash([]);
 $('#ohlc-hover').textContent='O '+fmt(active,c.open)+'  H '+fmt(active,c.high)+'  L '+fmt(active,c.low)+'  C '+fmt(active,c.close);
 }else {$('#ohlc-hover').textContent=''}
}
function openCommand(){const back=$('#command-backdrop');back.hidden=false;$('#command-input').value='';commandIndex=0;renderCommands();requestAnimationFrame(()=>$('#command-input').focus())}
function closeCommand(){$('#command-backdrop').hidden=true;}
function renderCommands(){
 const query=$('#command-input').value.toLowerCase().trim();
 const pages=[['Crypto signals','/crypto.html'],['Forex signals','/forex.html'],['Membership & billing','/billing.html'],['Messages & support','/support.html'],['Admin operations','/ops.html']];
 commandMatches=[...symbols.map(x=>({label:x.name,sub:x.market.toUpperCase(),symbol:x.symbol})),...pages.map(([label,url])=>({label,sub:'PAGE',url}))].filter(x=>(x.label+' '+x.sub+' '+(x.symbol||'')).toLowerCase().includes(query));
 if(commandIndex>=commandMatches.length)commandIndex=0;
 $('#command-results').innerHTML=commandMatches.slice(0,14).map((x,i)=>'<button data-cmd="'+i+'" class="'+(i===commandIndex?'active':'')+'"><span>'+x.label+'</span><small>'+x.sub+'</small></button>').join('')||'<div class="list-loading">No matching instruments or pages.</div>';
}
function runCommand(i){const x=commandMatches[i];if(!x)return;if(x.url){location.href=x.url;return}select(x.symbol);closeCommand();}
function bind(){
 document.addEventListener('click',e=>{
  const sym=e.target.closest('[data-symbol]');if(sym){select(sym.dataset.symbol);return}
  const mode=e.target.closest('[data-market-mode]');if(mode){selectMarket(mode.dataset.marketMode);return}
  const int=e.target.closest('[data-int]');if(int){timeframe=int.dataset.int;$$('[data-int]').forEach(b=>b.classList.toggle('active',b===int));loadCandles();return}
  const bf=e.target.closest('[data-filter]');if(bf){filter=bf.dataset.filter;$$('[data-filter]').forEach(b=>b.classList.toggle('active',b===bf));renderRows();return}
  const bs=e.target.closest('[data-board]');if(bs){tableFilter=bs.dataset.board;$$('[data-board]').forEach(b=>b.classList.toggle('active',b===bs));renderRows();return}
  const cmd=e.target.closest('[data-cmd]');if(cmd){runCommand(Number(cmd.dataset.cmd));return}
 });
 $('#open-command').onclick=openCommand;$('#focus-search').onclick=openCommand;$('#command-close').onclick=closeCommand;
 $('#command-backdrop').onclick=e=>{if(e.target.id==='command-backdrop')closeCommand()};
 $('#command-input').oninput=()=>{commandIndex=0;renderCommands()};
 $('#command-input').onkeydown=e=>{
  if(e.key==='ArrowDown'){e.preventDefault();commandIndex=Math.min(commandMatches.length-1,commandIndex+1);renderCommands()}
  if(e.key==='ArrowUp'){e.preventDefault();commandIndex=Math.max(0,commandIndex-1);renderCommands()}
  if(e.key==='Enter'){e.preventDefault();runCommand(commandIndex)}
 };
 document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommand()}if(e.key==='Escape')closeCommand()});
 $('#refresh-all').onclick=()=>{getQuotes('crypto');getQuotes('forex');loadCandles()};
 $('#chart-reset').onclick=loadCandles;
 $('#mobile-menu').onclick=openCommand;
 const cv=$('#chart-canvas');
 cv.addEventListener('mousemove',e=>{if(!candles.length)return;const r=cv.getBoundingClientRect(),chartW=r.width-18-74,count=Math.min(72,candles.length);hover=Math.max(0,Math.min(count-1,Math.floor(((e.clientX-r.left)-18)/chartW*count)));draw()});
 cv.addEventListener('mouseleave',()=>{hover=-1;draw()});
 window.addEventListener('resize',draw);
 if('ResizeObserver'in window)new ResizeObserver(draw).observe(cv);
}
clock();setInterval(clock,1000);
const pair=new URL(location.href).searchParams.get('pair');if(bySymbol[pair])active=pair;
bind();renderRows();select(active);getQuotes('crypto');getQuotes('forex');
setInterval(()=>{if(document.visibilityState!=='hidden'){getQuotes('crypto');getQuotes('forex')}},20000);
setInterval(()=>{if(document.visibilityState!=='hidden')loadCandles()},90000);
})();