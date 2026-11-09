/* SignalChart Interactive Chart v1. Trading research visualization only; no synthetic prices. */
(function(){
'use strict';
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const valid=v=>Number.isFinite(Number(v));
function create(canvas,options={}){
 if(!canvas)return null;
 const box=canvas.parentElement,ohlc=options.ohlcTarget||null;
 const settings={bars:[],symbol:'',timeframe:'',digits:2,span:64,end:null,hover:null,drag:false,pointers:new Map(),pinch:null,indicators:true,volume:true,raf:0,changed:false,lastDataLen:0,lastLastTime:null,lastFirstTime:null};
 const maxBars=()=>Math.max(12,settings.bars.length);
 const money=v=>valid(v)?Number(v).toLocaleString('en-US',{minimumFractionDigits:settings.digits,maximumFractionDigits:settings.digits}):'—';
 const timeText=t=>{
  const d=new Date(t*1000);if(!Number.isFinite(d.getTime()))return '—';
  return /^(1d|1w|1mo)$/.test(settings.timeframe)?d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'2-digit'}):d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
 };
 const geometry=()=>{
  const r=canvas.getBoundingClientRect(),w=Math.max(245,r.width),h=Math.max(195,r.height);
  const right=w<440?66:81,left=12,top=22,bottom=36,volumeHeight=settings.volume?Math.max(26,Math.min(56,h*.16)):0;
  return{w,h,left,right,top,bottom,volumeHeight,plotWidth:Math.max(55,w-left-right),priceHeight:Math.max(68,h-top-bottom-volumeHeight-12)};
 };
 function visible(){
  const count=Math.max(1,settings.bars.length);
  if(settings.end===null)settings.end=count+1.4;
  settings.span=clamp(settings.span,Math.min(12,count),Math.max(12,count+10));
  settings.end=clamp(settings.end,Math.min(count,settings.span),count+5);
  return {start:settings.end-settings.span,end:settings.end};
 }
 function plot(){
  settings.raf=0;if(!canvas.isConnected)return;
  const b=settings.bars,g=geometry(),dpr=Math.min(g.w<700?3.5:2.75,window.devicePixelRatio||1),pw=Math.round(g.w*dpr),ph=Math.round(g.h*dpr);
  if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph}
  const ctx=canvas.getContext('2d');if(!ctx)return;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,g.w,g.h);
  ctx.fillStyle='rgba(15,15,23,.04)';ctx.fillRect(0,0,g.w,g.h);
  if(!b.length){ctx.font='12px system-ui,sans-serif';ctx.fillStyle='#aea7b5';ctx.fillText('Loading market candles…',20,g.h/2);return}
  const {start,end}=visible(),first=clamp(Math.floor(start),0,b.length-1),last=clamp(Math.ceil(end),0,b.length),seg=b.slice(first,last);
  if(!seg.length)return;
  let lo=Infinity,hi=-Infinity,volumeMax=0;
  for(const c of seg){lo=Math.min(lo,c.low);hi=Math.max(hi,c.high);volumeMax=Math.max(volumeMax,c.volume||0)}
  const delta=Math.max(hi-lo,hi*.000002),pMin=lo-delta*.08,pMax=hi+delta*.08,pRange=pMax-pMin;
  const x=i=>g.left+(i+.5-start)/settings.span*g.plotWidth;
  const y=v=>g.top+(pMax-v)/pRange*g.priceHeight;
  const fromY=yVal=>pMax-(yVal-g.top)/g.priceHeight*pRange;
  const step=g.plotWidth/settings.span;
  ctx.textBaseline='middle';ctx.font='10px system-ui,-apple-system,sans-serif';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
   const py=g.top+g.priceHeight*i/4,v=pMax-i*pRange/4;
   ctx.strokeStyle='rgba(255,175,119,.075)';ctx.beginPath();ctx.moveTo(g.left,py);ctx.lineTo(g.w-g.right+5,py);ctx.stroke();
   ctx.fillStyle='#a8a0ad';ctx.textAlign='left';ctx.fillText(money(v),g.w-g.right+11,py);
  }
  const candleWidth=clamp(step*.64,1.4,19);
  for(let i=first;i<last;i++){
   const c=b[i],cx=x(i),up=c.close>=c.open,cl=up?'#2ad798':'#f06b72';
   if(cx<g.left-15||cx>g.w-g.right+15)continue;
   ctx.strokeStyle=cl;ctx.fillStyle=cl;ctx.beginPath();ctx.moveTo(cx,y(c.high));ctx.lineTo(cx,y(c.low));ctx.stroke();
   const bodyTop=Math.min(y(c.open),y(c.close)),bodyH=Math.max(1,Math.abs(y(c.close)-y(c.open)));
   ctx.fillRect(cx-candleWidth/2,bodyTop,candleWidth,bodyH);
   if(settings.volume){
    const volTop=g.top+g.priceHeight+12,barH=Math.max(1,(c.volume||0)/Math.max(1,volumeMax)*g.volumeHeight);
    ctx.fillStyle=up?'rgba(35,186,128,.32)':'rgba(210,86,102,.32)';
    ctx.fillRect(cx-candleWidth/2,volTop+g.volumeHeight-barH,candleWidth,barH);
   }
  }
  if(settings.indicators){
   const makeEMA=period=>{let value=b[0].close,k=2/(period+1),arr=new Array(b.length);for(let i=0;i<b.length;i++){value=i===0?b[i].close:b[i].close*k+value*(1-k);arr[i]=value}return arr};
   for(const [period,color]of [[20,'#ffa35e'],[50,'#a99afe']]){
    const values=makeEMA(period);
    ctx.strokeStyle=color;ctx.lineWidth=1.45;ctx.globalAlpha=.86;ctx.beginPath();let began=false;
    for(let i=first;i<last;i++){const cx=x(i),cy=y(values[i]);if(!began){ctx.moveTo(cx,cy);began=true}else ctx.lineTo(cx,cy)}ctx.stroke();ctx.globalAlpha=1;ctx.lineWidth=1;
   }
  }
  ctx.fillStyle='#a59caa';ctx.textBaseline='middle';ctx.font='9px system-ui,sans-serif';
  for(let j=0;j<5;j++){
   const idx=clamp(Math.round(start+(settings.span-1)*j/4),0,b.length-1),v=b[idx],cx=x(idx),label=timeText(v.time);
   if(cx<0||cx>g.w-g.right)continue;
   ctx.textAlign=j===0?'left':j===4?'right':'center';ctx.fillText(label,clamp(cx,10,g.w-g.right),g.h-15);
  }
  // Last traded candle marker; uses only source OHLC values.
  const lastBar=b[b.length-1];
  if(lastBar&&b.length-1>=start-1&&b.length-1<=end+.5){
   const py=y(lastBar.close);
   if(py>=g.top-3&&py<=g.top+g.priceHeight+3){
    ctx.strokeStyle='rgba(255,139,77,.53)';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(Math.max(g.left,x(b.length-1)),py);ctx.lineTo(g.w-g.right+5,py);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#fa864b';ctx.fillRect(g.w-g.right+5,py-9,g.right-8,18);
    ctx.fillStyle='#1d1720';ctx.textAlign='center';ctx.font='bold 10px system-ui,sans-serif';ctx.fillText(money(lastBar.close),g.w-g.right/2+2,py);
   }
  }
  if(settings.hover){
   const px=clamp(settings.hover.x,g.left,g.w-g.right),py=clamp(settings.hover.y,g.top,g.top+g.priceHeight);
   const index=clamp(Math.round(start+(px-g.left)/g.plotWidth*settings.span-.5),0,b.length-1),c=b[index];
   ctx.setLineDash([4,4]);ctx.strokeStyle='rgba(243,225,220,.6)';ctx.beginPath();ctx.moveTo(x(index),g.top);ctx.lineTo(x(index),g.h-g.bottom+3);ctx.moveTo(g.left,py);ctx.lineTo(g.w-g.right+4,py);ctx.stroke();ctx.setLineDash([]);
   ctx.fillStyle='#ddd0d5';ctx.font='bold 10px system-ui,sans-serif';ctx.textAlign='left';
   const label='O '+money(c.open)+'   H '+money(c.high)+'   L '+money(c.low)+'   C '+money(c.close);
   if(ohlc)ohlc.textContent=label+' · '+timeText(c.time);
   const value=money(fromY(py));ctx.fillStyle='#5d505b';ctx.fillRect(g.w-g.right+5,py-9,g.right-8,18);ctx.fillStyle='#f5e6e6';ctx.textAlign='center';ctx.fillText(value,g.w-g.right/2+2,py);
  }
  if(!settings.hover&&ohlc)ohlc.textContent='';
 }
 function schedule(){if(settings.raf)return;settings.raf=requestAnimationFrame(plot)}
 function setData(raw,meta={}){
  if(!Array.isArray(raw)||!raw.length)return;
  const list=raw.filter(c=>c&&[c.time,c.open,c.high,c.low,c.close].every(valid)).slice(-600);
  if(!list.length)return;
  const changed=meta.symbol!==settings.symbol||meta.timeframe!==settings.timeframe;
  const oldEnd=settings.end,oldLength=settings.bars.length,follow=oldEnd===null||oldEnd>=oldLength-1;
  settings.bars=list;settings.symbol=meta.symbol||settings.symbol;settings.timeframe=meta.timeframe||settings.timeframe;settings.digits=clamp(Number(meta.digits)||2,0,8);
  if(changed){settings.span=clamp(65,Math.min(12,list.length),Math.max(12,list.length));settings.end=list.length+1.5;settings.hover=null}
  else if(follow){settings.end=list.length+1.5}
  else if(oldLength===list.length&&list[0].time!==settings.lastFirstTime){settings.end=Math.max(settings.span,oldEnd-1)}
  settings.lastFirstTime=list[0].time;settings.lastLastTime=list.at(-1).time;
  schedule()
 }
 function zoom(factor,centerX){
  if(settings.bars.length<3)return;
  const g=geometry(),{start}=visible(),f=clamp((centerX-g.left)/g.plotWidth,0,1),anchor=start+f*settings.span;
  const next=clamp(settings.span*factor,Math.min(8,settings.bars.length),settings.bars.length+5);
  settings.span=next;settings.end=clamp(anchor+(1-f)*next,next,settings.bars.length+5);schedule()
 }
 function pan(pixels){if(!settings.bars.length)return;const g=geometry();settings.end=clamp(settings.end-pixels/g.plotWidth*settings.span,settings.span,settings.bars.length+5);schedule()}
 function reset(){settings.span=clamp(65,Math.min(12,settings.bars.length),Math.max(12,settings.bars.length));settings.end=settings.bars.length+1.5;settings.hover=null;schedule()}
 function pos(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
 canvas.tabIndex=0;canvas.style.touchAction='none';canvas.style.cursor='crosshair';
 canvas.setAttribute('aria-label','Interactive candlestick chart. Drag to pan, scroll or pinch to zoom, double-tap to return to latest. Arrow keys pan and plus/minus keys zoom.');
 canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.18:.84,pos(e).x)},{passive:false});
 canvas.addEventListener('dblclick',e=>{e.preventDefault();reset()});
 canvas.addEventListener('pointerdown',e=>{
  canvas.setPointerCapture?.(e.pointerId);settings.pointers.set(e.pointerId,pos(e));settings.drag=true;
  if(settings.pointers.size===2){const a=[...settings.pointers.values()];settings.pinch={distance:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),span:settings.span}}
 });
 canvas.addEventListener('pointermove',e=>{
  const pt=pos(e),prev=settings.pointers.get(e.pointerId);
  if(settings.pointers.has(e.pointerId))settings.pointers.set(e.pointerId,pt);
  if(settings.pointers.size===2){
   const a=[...settings.pointers.values()],distance=Math.max(10,Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y));
   if(settings.pinch?.distance){const mid=(a[0].x+a[1].x)/2;zoom(settings.pinch.span/settings.span*settings.pinch.distance/distance,mid)}settings.hover=null;
  }else if(prev&&settings.drag){pan(pt.x-prev.x);settings.hover=e.pointerType==='mouse'?pt:null}
  else if(e.pointerType!=='touch'){settings.hover=pt;schedule()}
 });
 function release(e){settings.pointers.delete(e.pointerId);if(settings.pointers.size<2)settings.pinch=null;if(!settings.pointers.size)settings.drag=false;if(e.pointerType==='touch'){settings.hover=null;schedule()}}
 canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
 canvas.addEventListener('pointerleave',e=>{if(!settings.drag){settings.hover=null;schedule()}});
 canvas.addEventListener('keydown',e=>{
  if(['ArrowLeft','ArrowRight','+','=','-','Home','End'].includes(e.key)){e.preventDefault();
   if(e.key==='ArrowLeft')pan(54);else if(e.key==='ArrowRight')pan(-54);
   else if(e.key==='+'||e.key==='=')zoom(.8,geometry().w/2);else if(e.key==='-')zoom(1.2,geometry().w/2);else reset()
  }
 });
 if(window.ResizeObserver){const obs=new ResizeObserver(schedule);obs.observe(canvas);settings.resizeObserver=obs}
 const api={setData,zoom,pan,reset,render:schedule,setIndicators:shown=>{settings.indicators=shown;schedule()},setVolume:shown=>{settings.volume=shown;schedule()},getState:()=>({visibleCandles:Math.round(settings.span),from:Math.round(settings.end-settings.span),to:Math.round(settings.end),length:settings.bars.length}),destroy:()=>{settings.resizeObserver?.disconnect();if(settings.raf)cancelAnimationFrame(settings.raf)}};
 return api;
}
let dashboard=null;
function mount(){
 const cv=document.getElementById('sc-candles');if(!cv)return null;
 if(dashboard)return dashboard;
 const container=cv.closest('.sc-chart-canvas');
 const tooltip=document.getElementById('sc-ohlc');
 dashboard=create(cv,{ohlcTarget:tooltip});
 if(container&&!container.querySelector('.sc-chart-toolbox')){
  const toolbar=document.createElement('div');toolbar.className='sc-chart-toolbox';toolbar.setAttribute('aria-label','Chart controls');
  for(const [title,action,label] of [['Zoom in','in','+'],['Zoom out','out','−'],['Return to latest','reset','↺'],['Toggle EMA lines','ema','EMA'],['Toggle volume','volume','VOL']]){
   const btn=document.createElement('button');btn.type='button';btn.title=title;btn.setAttribute('aria-label',title);btn.dataset.chartAction=action;btn.textContent=label;if(action==='ema'||action==='volume')btn.setAttribute('aria-pressed','true');toolbar.append(btn)
  }
  toolbar.addEventListener('click',e=>{
   const button=e.target.closest('[data-chart-action]');if(!button)return;
   const action=button.dataset.chartAction;
   if(action==='in')dashboard.zoom(.77,cv.getBoundingClientRect().width/2);
   else if(action==='out')dashboard.zoom(1.3,cv.getBoundingClientRect().width/2);
   else if(action==='reset')dashboard.reset();
   else if(action==='ema'||action==='volume'){const active=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(active));if(action==='ema')dashboard.setIndicators(active);else dashboard.setVolume(active)}
  });
  container.append(toolbar);
  const hint=document.createElement('span');hint.className='sc-chart-hint';hint.textContent='Drag to explore · Scroll / pinch to zoom';container.append(hint);
 }
 return dashboard;
}
window.SignalChartInteractive={
 create,
 mount,
 draw(bars,symbol,timeframe,digits){const instance=mount();instance?.setData(bars,{symbol,timeframe,digits});},
 reset(){mount()?.reset()},
 getState(){return dashboard?.getState()||null}
};
})();