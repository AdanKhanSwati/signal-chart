(()=>{
'use strict';
const emit=(type,detail)=>dispatchEvent(new CustomEvent(type,{detail}));
const state={connected:false,selected:'',interval:'',latest:{},tickClose:null,klineClose:null,seq:0};
function subscribe(stream,handle,notify){
 let sock=null,stopped=false,retry=0,fallback=false;
 const urls=['wss://fstream.binance.com/market/ws/','wss://fstream.binance.com/ws/'];
 const connect=()=>{
  if(stopped)return;
  const url=urls[fallback?1:0]+stream;
  try{sock=new WebSocket(url)}catch{setTimeout(connect,2000);return}
  sock.onopen=()=>{retry=0;notify?.(true)};
  sock.onmessage=e=>{try{let p=JSON.parse(e.data);handle(p.data||p)}catch{}};
  sock.onclose=()=>{notify?.(false);if(stopped)return;retry++;if(retry===2)fallback=!fallback;setTimeout(connect,Math.min(30000,1000*Math.pow(1.7,Math.min(retry,7))))};
  sock.onerror=()=>{};
 };
 connect();
 return()=>{stopped=true;try{sock?.close()}catch{}};
}
function start(){
 if(!('WebSocket'in window))return;
 state.tickClose?.();
 let queue={},timer=null;
 state.tickClose=subscribe('!miniTicker@arr',p=>{
  const rows=Array.isArray(p)?p:[p];
  for(const q of rows){
   if(!q?.s||!q.s.endsWith('USDT')||q.st===2)continue;
   const price=Number(q.c),start=Number(q.o);if(!(price>0))continue;
   const data={price,asof:new Date(Number(q.E)||Date.now()).toISOString(),received_at:new Date().toISOString(),source:'Binance Futures streaming ticker',stale:false,indicative:false,changePercent:start>0?(price/start-1)*100:null,high:Number(q.h),low:Number(q.l),volume:Number(q.q)};
   state.latest[q.s]=data;queue[q.s]=data;
  }
  if(timer===null){timer=setTimeout(()=>{const updates=queue;queue={};timer=null;emit('signalchart:tick',{updates,connected:state.connected})},350)}
 },connected=>{state.connected=connected;emit('signalchart:feed-status',{connected,asof:new Date().toISOString()})});
}
function select(symbol,tf){
 const interval=['1m','5m','15m','1h','4h','1d','1w'].includes(tf)?tf:'1d';
 if(state.selected===symbol&&state.interval===interval&&state.klineClose)return;
 state.klineClose?.();state.klineClose=null;state.selected=symbol;state.interval=interval;
 if(!/^[A-Z0-9]{3,20}USDT$/.test(symbol||''))return;
 const generation=++state.seq;
 state.klineClose=subscribe(symbol.toLowerCase()+'@kline_'+interval,d=>{
  const k=d.k;if(!k||generation!==state.seq||String(d.s).toUpperCase()!==state.selected)return;
  const c={time:Math.floor(Number(k.t)/1000),open:Number(k.o),high:Number(k.h),low:Number(k.l),close:Number(k.c),volume:Number(k.v),closed:!!k.x};
  if(Object.values(c).slice(0,6).some(x=>!Number.isFinite(x)))return;
  emit('signalchart:kline',{symbol:d.s,interval,candle:c,eventTime:Number(d.E)||Date.now()});
 });
}
window.SignalChartFeed={start,select,state};
start();
addEventListener('pagehide',()=>{state.tickClose?.();state.klineClose?.()},{once:true});
})();