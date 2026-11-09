(()=>{'use strict';
const $=id=>document.getElementById(id),status=$('sh-status'),area=$('sh-setups'),wallet=$('sh-wallet');
if(!status||!area||!wallet)return;
let result=null,session=null,busy=false,client=null;
try{const saved=localStorage.getItem('signalchart-wallet-size-v1');if(saved&&Number(saved)>0)wallet.value=saved}catch{}
const usd=n=>Number.isFinite(Number(n))?'$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const fmt=(n,d=5)=>Number.isFinite(Number(n))?Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const hour=()=>new Date(Math.floor(Date.now()/3600000)*3600000).toISOString();
const small=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e};
function message(text,error=false){status.classList.toggle('error',error);status.querySelector('span').textContent=text}
function setContent(text,link=false){area.replaceChildren();const wrap=small('div','sh-empty'),title=small('strong','',text),p=small('p','',link?'A verified SignalChart account with an active trial or subscription is required.':'Try refreshing the page or open the individual Crypto/Forex scanners.');wrap.append(title,p);if(link){const a=small('a','sp-cta','Sign in / Subscribe ↗');a.href='/account.html';a.style.marginTop='14px';wrap.append(a)}area.append(wrap)}
function sizing(setup,market){
 const balance=Number(wallet.value),s=setup;
 if(!(balance>0&&Number.isFinite(balance)))return null;
 const risk=balance*.005,stopFraction=s.stopDistancePercent/100,leverage=Math.min(2,Math.max(1,Number(s.suggestedLeverage)||1));
 if(!(stopFraction>0))return null;
 const desiredNotional=risk/stopFraction,marginCap=balance*.1,notional=Math.min(desiredNotional,marginCap*leverage),margin=notional/leverage;
 return{margin,notional,actualRisk:notional*stopFraction,leverage,wallet:balance,market}
}
function stats(group,details){
 const grid=small('div',group),list=details;
 for(const[label,value]of list){const div=small('div'),t=small('span','',label),v=small('strong','',value);div.append(t,v);grid.append(div)}
 return grid;
}
function itemCard(item){
 const qualified=item.status==='QUALIFIED'&&item.setup;
 const card=small('article','sh-item'+(qualified?' qualified':''));
 const header=small('div','sh-item-title');const label=small('strong','',item.label||item.symbol);
 const badge=small('span','sh-badge'+(qualified?' qualified':''),qualified?(item.direction+' · SETUP'):item.status.replaceAll('_',' '));header.append(label,badge);card.append(header);
 const reason=small('div','sh-item-meta');reason.append(small('span','',item.market.toUpperCase()),small('span','',item.asof?'Candle '+new Date(item.asof).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'No recent candle'),small('span','',item.indicators?'RSI '+item.indicators.rsi14:'Data not available'));card.append(reason);
 if(qualified){
 const s=item.setup,d=item.symbol==='USDJPY'?3:item.market==='forex'?5:item.symbol==='BTCUSDT'||item.symbol==='ETHUSDT'?2:4;
 card.append(stats('sh-setup-levels',[['ENTRY',fmt(s.entry,d)],['STOP LOSS',fmt(s.stopLoss,d)],['TARGET 1',fmt(s.takeProfit1,d)],['TARGET 2',fmt(s.takeProfit2,d)]]));
 const positions=sizing(s,item.market);
 if(positions)card.append(stats('sh-sizing',[['WALLET MARGIN',usd(positions.margin)],['TOTAL EXPOSURE',usd(positions.notional)],['LEVERAGE',positions.leverage+'×'],['RISK AT STOP',usd(positions.actualRisk)],['WALLET RISK',fmt(positions.actualRisk/positions.wallet*100,2)+'%'],['RISK / REWARD','1:1.5 / 1:2.5']]));
 else card.append(small('p','sh-invalid','Enter your USD wallet balance above to calculate your capital allocation, exposure and leverage.'));
 const why=small('ul','sh-item-reasons');for(const s of (item.reasons||[]).slice(0,5)){const li=small('li','',s);why.append(li)}card.append(why);
 card.append(small('p','sh-invalid','Invalidation: '+s.invalidation+'. Valid until '+new Date(s.validUntil).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+'.'));
 }else{
 const why=small('p','sh-invalid',(item.reasons||[]).slice(0,3).join(' · ')||'This market did not qualify during the latest hourly review.');card.append(why);
 }
 const foot=small('div','sh-item-foot',qualified?'Technical-rule alignment: '+item.confidence+'. Fees, slippage and broker margin rules are not included.':'No position is recommended for this market in the current cycle.');card.append(foot);return card;
}
function render(){
 if(!result)return;
 area.replaceChildren();const selected=(result.items||[]).filter(x=>x.status==='QUALIFIED');const newsBlocked=(result.items||[]).filter(x=>x.status==='NEWS_BLACKOUT'||x.status==='ECONOMIC_CALENDAR_UNVERIFIED');
 message(result.marketsReviewed+' markets reviewed · '+(selected.length?selected.length+' technical setup'+(selected.length>1?'s':''):'NO TRADE this hour')+(newsBlocked.length?' · '+newsBlocked.length+' news/calendar blocked':''));
 $('sh-cycle').textContent='NEXT CYCLE · '+new Date(result.nextReviewAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
 $('sh-research-time').textContent='Generated '+new Date(result.generatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' · Hour bucket UTC';
 if(selected.length){for(const x of selected.slice(0,4))area.append(itemCard(x))}
 else{const box=small('div','sh-empty');box.append(small('strong','',newsBlocked.length?'NO TRADE — economic risk controls':'NO TRADE — conditions not aligned'),small('p','',newsBlocked.length?'One or more technical conditions were blocked by dated macroeconomic releases or incomplete event coverage. Capital allocation and leverage recommendations are withheld.':'The 1-hour and higher-timeframe filters did not confirm a sufficient entry across the reviewed markets. No wallet allocation is recommended for this cycle.'));area.append(box)}
 const monitor=small('div','sh-monitor');for(const x of result.items||[]){const a=small('div'),tag=small('strong','',x.label||x.symbol),st=small('small','',x.status.replaceAll('_',' '));a.append(tag,st);monitor.append(a)}
 const wrapper=small('div','sh-empty');wrapper.style.padding='10px';wrapper.append(small('strong','','All markets reviewed'));wrapper.append(monitor);area.append(wrapper);
}
async function getAuth(){
 const c=await fetch('/api/config',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(new Error('Account service unavailable')));
 if(!c.authReady)throw Error('Secure account access is unavailable');
 if(!window.supabase?.createClient){await new Promise((resolve,reject)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';sc.onload=resolve;sc.onerror=()=>reject(new Error('Unable to load sign-in service'));document.head.append(sc)})}
 client=window.supabase.createClient(c.supabaseUrl,c.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
 session=(await client.auth.getSession()).data?.session;
}
async function refresh(){
 if(busy)return;busy=true;$('sh-refresh').disabled=true;
 try{
  if(!client)await getAuth();
  if(!session){message('Sign in to unlock hourly analysis');setContent('Member sign-in required',true);return}
  message('Researching closed market candles and momentum…');
  const response=await fetch('/api/research?mode=current',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
  if(response.status===401||response.status===403){message('Active membership required',true);setContent('Subscription or trial access required',true);return}
  if(!response.ok)throw Error('Hourly market research is temporarily unavailable');
  const payload=await response.json();
  if(!Array.isArray(payload.items))throw Error('Incomplete market analysis response');
  result=payload;render();
 }catch(e){message(e.message,true);setContent('Analysis temporarily unavailable')}finally{busy=false;$('sh-refresh').disabled=false}
}
wallet.addEventListener('input',()=>{try{wallet.value?localStorage.setItem('signalchart-wallet-size-v1',wallet.value):localStorage.removeItem('signalchart-wallet-size-v1')}catch{}if(result)render()});
$('sh-refresh').addEventListener('click',refresh);
refresh();
let lastHour=hour();
setInterval(()=>{const h=hour();if(h!==lastHour){lastHour=h;if(!document.hidden)refresh()}},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&result?.hour!==hour())refresh()});
})();