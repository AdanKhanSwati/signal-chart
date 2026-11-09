(()=>{'use strict';
const canvas=document.getElementById('sc-pulse-canvas');if(!canvas)return;
const price=document.getElementById('sc-pulse-price'),status=document.getElementById('sc-pulse-status'),note=document.getElementById('sc-pulse-note');
const history=[],maxPoints=180;let lastEvent=0,feedReady=false,renderer=null;
function fmt(v){return Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function update(p,source){
 const value=Number(p.price);if(!(value>0))return;
 const stamp=Date.parse(p.asof||'');if(!Number.isFinite(stamp))return;
 const last=history.at(-1);
 if(last&&stamp<=last.t)return;
 history.push({t:stamp,v:value});if(history.length>maxPoints)history.shift();
 lastEvent=Date.now();price.textContent='$'+fmt(value);status.textContent=source==='stream'?'LIVE · EXCHANGE STREAM':'DELAYED · REST FALLBACK';
 note.textContent='Source time '+new Date(stamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · '+history.length+' real quote updates';
 requestAnimationFrame(draw)
}
function draw(){
 const box=canvas.getBoundingClientRect(),w=Math.max(270,box.width),h=Math.max(150,box.height),dpr=Math.min(2,devicePixelRatio||1);
 canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
 const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const left=15,right=83,top=23,bottom=20,width=Math.max(10,w-left-right),height=h-top-bottom;
 const raw=history.slice(-maxPoints);
 ctx.lineWidth=1;ctx.font='10px system-ui';ctx.textAlign='left';
 if(raw.length<2){ctx.fillStyle='#b6a8b4';ctx.fillText('Waiting for consecutive exchange quotes…',18,h/2);return}
 const lo=Math.min(...raw.map(x=>x.v)),hi=Math.max(...raw.map(x=>x.v)),spread=Math.max((hi-lo)*1.2,hi*.000008),min=lo-spread*.1,max=min+spread;
 const y=v=>top+(max-v)/spread*height,x=i=>left+i*width/(Math.max(maxPoints-1,raw.length-1));
 for(let i=0;i<=4;i++){const yy=top+i*height/4;ctx.strokeStyle='#ff9c6830';ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right+2,yy);ctx.stroke();ctx.fillStyle='#a7a0ad';ctx.fillText(fmt(max-i*spread/4),w-right+7,yy+3)}
 ctx.beginPath();raw.forEach((r,i)=>i?ctx.lineTo(x(i),y(r.v)):ctx.moveTo(x(i),y(r.v)));ctx.strokeStyle='#ff914f';ctx.lineWidth=2;ctx.stroke();
 ctx.lineTo(x(raw.length-1),h-bottom);ctx.lineTo(left,h-bottom);ctx.closePath();
 const grad=ctx.createLinearGradient(0,top,0,h);grad.addColorStop(0,'rgba(255,132,73,.25)');grad.addColorStop(1,'rgba(255,132,73,0)');ctx.fillStyle=grad;ctx.fill();
 const latest=raw.at(-1);ctx.fillStyle='#ffae76';ctx.beginPath();ctx.arc(x(raw.length-1),y(latest.v),4,0,Math.PI*2);ctx.fill();
}
window.addEventListener('signalchart:tick',e=>{const q=e.detail?.updates?.BTCUSDT;if(q)update(q,'stream')});
window.addEventListener('signalchart:feed-status',e=>{feedReady=!!e.detail?.connected;if(!feedReady&&Date.now()-lastEvent>9000)status.textContent='STREAM RECONNECTING'});
if('ResizeObserver'in window)new ResizeObserver(draw).observe(canvas);else window.addEventListener('resize',draw);
setInterval(()=>{if(Date.now()-lastEvent>15000){status.textContent='DELAYED · AWAITING EXCHANGE';if(!document.hidden)fetch('/api/quotes?market=crypto',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{if(d?.quotes?.BTCUSDT)update(d.quotes.BTCUSDT,'rest')}).catch(()=>{})}},15000);
draw();
})();