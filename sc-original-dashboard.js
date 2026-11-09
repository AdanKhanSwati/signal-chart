(()=>{'use strict';
const $=q=>document.querySelector(q),$$=q=>[...document.querySelectorAll(q)];
const MARKETS=[
{s:'BTCUSDT',name:'BTC/USDT',label:'Bitcoin',icon:'₿',type:'crypto',digits:2},
{s:'ETHUSDT',name:'ETH/USDT',label:'Ethereum',icon:'Ξ',type:'crypto',digits:2},
{s:'SOLUSDT',name:'SOL/USDT',label:'Solana',icon:'S',type:'crypto',digits:3},
{s:'XRPUSDT',name:'XRP/USDT',label:'XRP',icon:'X',type:'crypto',digits:5},
{s:'DOGEUSDT',name:'DOGE/USDT',label:'Dogecoin',icon:'Ð',type:'crypto',digits:6},
{s:'EURUSD',name:'EUR/USD',label:'Euro / Dollar',icon:'€',type:'forex',digits:5},
{s:'GBPUSD',name:'GBP/USD',label:'Pound / Dollar',icon:'£',type:'forex',digits:5},
{s:'USDJPY',name:'USD/JPY',label:'Dollar / Yen',icon:'¥',type:'forex',digits:3}
];
const BY=Object.fromEntries(MARKETS.map(x=>[x.s,x]));
const state={quotes:{},details:{},candles:[],daily:{},selected:'BTCUSDT',timeframe:'1m',reqId:0,hover:-1,searchIndex:0,searchResults:[],token:null,marketAccess:false,scanner:{},account:null,updating:false};
const qs=new URL(location.href).searchParams.get('pair');if(BY[qs])state.selected=qs;
const n=x=>Number(x),exists=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(n(x));
const num=(v,d=2)=>exists(v)?n(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const compact=v=>{if(!exists(v))return '—';const a=Math.abs(n(v));return (a>=1e12?num(v/1e12,2)+'T':a>=1e9?num(v/1e9,2)+'B':a>=1e6?num(v/1e6,1)+'M':a>=1e3?num(v/1e3,1)+'K':num(v,2))};
const money=v=>exists(v)?'$'+compact(v):'—';
const pct=v=>exists(v)?(n(v)>0?'+':'')+num(v,2)+'%':'—';
const market=()=>BY[state.selected], trend=v=>exists(v)?(n(v)>0?'up':n(v)<0?'down':'neutral'):'neutral';
const timeAt=s=>{let d=new Date(s);return Number.isFinite(d.valueOf())?d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}):'—'};
const cssNum=(v)=>Math.max(0,Math.min(100,v));
const asof=(sym,q)=>{if(!q||!exists(q.price))return 'UNAVAILABLE';const age=Date.now()-Date.parse(q.asof||'');return q.stale||!Number.isFinite(age)||age>(BY[sym].type==='forex'?25*60*1000:3*60*1000)?'DELAYED':'LIVE'};
const node=(tag,cls,txt)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(txt!==undefined)el.textContent=txt;return el};
function scLogo(p){const wrap=node('span','sc-market-logo');if(p.type==='crypto'){const name=String(p.base||p.s.replace(/USDT$/,'')).toLowerCase().replace(/^1000/,'');const im=node('img');im.alt='';im.loading='lazy';im.src='https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/'+name+'.png';im.onerror=()=>{im.onerror=null;im.src='https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/generic.png'};wrap.append(im)}else{const maps={EUR:'eu',USD:'us',GBP:'gb',JPY:'jp',CHF:'ch',CAD:'ca',AUD:'au',NZD:'nz',SGD:'sg',HKD:'hk',NOK:'no',SEK:'se',CNH:'cn',MXN:'mx',ZAR:'za',TRY:'tr',INR:'in',PKR:'pk'};for(const [i,v]of[p.base||p.s.slice(0,3),p.quote||p.s.slice(3)].entries()){const im=node('img','sc-flag sc-flag-'+i);im.src='https://flagcdn.com/w40/'+(maps[v]||'un')+'.png';im.alt='';im.loading='lazy';im.onerror=()=>im.style.display='none';wrap.append(im)}}return wrap}
function setText(selector,value){const e=$(selector);if(e)e.textContent=String(value??'—')}
function toastMissing(el,text){el.replaceChildren(node('div','sc-bars-loading',text))}
function updateHero(){
 const xs=MARKETS.filter(m=>m.type==='crypto').map(m=>state.details[m.s]?.stats?.changePercent);
 const valid=xs.filter(exists),positive=valid.filter(x=>n(x)>0).length,negative=valid.filter(x=>n(x)<0).length,flat=Math.max(0,MARKETS.filter(m=>m.type==='crypto').length-valid.length);
 setText('#sc-metric-breadth',valid.length?positive+'/'+valid.length:'—');setText('#sc-metric-breadth-note',valid.length?'Crypto assets advancing':'Waiting for 24h data');
 const ch=state.details.BTCUSDT?.stats?.changePercent;setText('#sc-metric-btc',pct(ch));$('#sc-metric-btc').className=trend(ch);
 setText('#sc-metric-qualified',state.account&&state.scanner.crypto&&state.scanner.forex?String([...state.scanner.crypto,...state.scanner.forex].filter(x=>x.status==='QUALIFIED').length):'—');
 setText('#sc-metric-qualified-note',state.account&&state.scanner.crypto&&state.scanner.forex?'From latest scan':state.account?'Scanner unavailable':'Sign in to view');
 const total=valid.length;const fraction=total?positive/total:null;
 setText('#sc-breadth-pct',fraction===null?'—':Math.round(fraction*100)+'%');setText('#sc-breadth-up',positive);setText('#sc-breadth-down',negative);setText('#sc-breadth-flat',flat);
 const segment=fraction===null?0:360*fraction;
 $('#sc-breadth-donut').style.background=total?'conic-gradient(#ff8e49 0deg '+segment+'deg,#3b3944 '+segment+'deg 360deg)':'conic-gradient(#4a454f 0deg 360deg)';
 const sentiment=total?(fraction>=.65?'Bullish':fraction<=.35?'Bearish':'Mixed'):'—';setText('#sc-sentiment-text',sentiment);
 setText('#sc-sentiment-note',total?positive+' of '+total+' crypto assets advancing':'Awaiting 24h market data');
 const dot=$('#sc-gauge-dot');if(fraction!==null){const phi=Math.PI*fraction;dot.setAttribute('cx',String(130+98*Math.cos(phi)));dot.setAttribute('cy',String(118-98*Math.sin(phi)));dot.style.opacity='1'}else dot.style.opacity='0';
}
function detailStats(){
 const crypto=MARKETS.filter(m=>m.type==='crypto').slice(0,5);const valid=crypto.filter(m=>exists(state.details[m.s]?.stats?.volume)&&n(state.details[m.s].stats.volume)>=0);
 const all=valid.reduce((a,m)=>a+n(state.details[m.s].stats.volume),0);
 setText('#sc-total-volume',all>0?'$'+compact(all):'—');
 if(all>0){
  const colors=['#ff873b','#9269ee','#398bf5','#45c893','#f0709b'];const ordered=valid.slice().sort((a,b)=>n(state.details[b.s].stats.volume)-n(state.details[a.s].stats.volume));
  let start=0,stops=[];for(const [i,m] of ordered.entries()){let end=start+n(state.details[m.s].stats.volume)/all*100;stops.push(colors[i%colors.length]+' '+start.toFixed(2)+'% '+end.toFixed(2)+'%');start=end}
  $('#sc-volume-ring').style.background='conic-gradient('+stops.join(',')+')';
  const leg=$('#sc-volume-legend');leg.replaceChildren();for(const [i,m] of ordered.slice(0,3).entries()){const row=node('div');const swatch=node('i');swatch.style.background=colors[i];row.append(swatch,node('span','',m.s.replace('USDT','')) ,node('strong','',num(100*n(state.details[m.s].stats.volume)/all,1)+'%'));leg.append(row)}
 }else toastMissing($('#sc-volume-legend'),'24h volume unavailable');
 renderBars();renderHeatmap();updateHero();
}
function renderBars(){
 const available=MARKETS.filter(m=>m.type==='crypto'&&exists(state.details[m.s]?.stats?.changePercent)).map(m=>({...m,change:n(state.details[m.s].stats.changePercent)}));
 const gainers=available.filter(m=>m.change>0).sort((a,b)=>b.change-a.change).slice(0,5);const losers=available.filter(m=>m.change<0).sort((a,b)=>a.change-b.change).slice(0,5);
 for(const [arr,id,down]of[[gainers,'sc-gainers',false],[losers,'sc-losers',true]]){
  const root=$('#'+id);root.replaceChildren();
  if(!arr.length){toastMissing(root,available.length?(down?'No declining assets today':'No advancing assets today'):'No 24h market changes');continue}
  const highest=Math.max(...arr.map(m=>Math.abs(m.change)),.001);
  for(const m of arr){
   const col=node('div','sc-bar-col'),val=node('span','sc-bar-val'+(down?' down':''),pct(m.change)),bar=node('div','sc-bar-visual'+(down?' down':'')),name=node('span','sc-bar-symbol',m.s.replace('USDT',''));
   bar.style.height=(22+65*Math.abs(m.change)/highest)+'px';col.title=m.name+' '+pct(m.change);col.append(val,bar,name);root.append(col)
  }
 }
}
function renderHeatmap(){
 const root=$('#sc-heatmap');root.replaceChildren();
 const selected=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT'];const valid=selected.filter(s=>exists(state.details[s]?.stats?.changePercent));
 if(!valid.length){toastMissing(root,'Market changes unavailable');return}
 let total=0;for(const s of selected){const p=state.details[s]?.stats?.changePercent;if(!exists(p))continue;let change=n(p);total+=change;
  const b=node('div','sc-heat-tile'),strength=Math.min(Math.abs(change),10)/10;
  b.style.background=change>=0?'linear-gradient(135deg,rgba(54,165,101,'+(0.45+strength*.45)+'),rgba(17,94,63,'+(0.65+strength*.25)+'))':'linear-gradient(135deg,rgba(207,73,83,'+(0.45+strength*.35)+'),rgba(98,29,53,'+(0.65+strength*.2)+'))';
  b.title=BY[s].name+' '+pct(change);b.append(node('strong','',BY[s].name.split('/')[0]),node('small','',pct(change)));root.append(b)
 }
 const blend=node('div','sc-heat-tile'),avg=total/valid.length;blend.style.background='linear-gradient(140deg,#3c3646,#282531)';blend.title='Average change across the tracked cryptocurrencies';blend.append(node('strong','', 'AVG'),node('small','',pct(avg)));root.append(blend);
}
function paintChart(){if(state.candles.length)window.SignalChartInteractive?.draw(state.candles,state.selected,state.timeframe,market().digits)}
function aggregate(bars,group){const out=[];for(let i=0;i<bars.length;i+=group){const sub=bars.slice(i,i+group);if(!sub.length)continue;out.push({time:sub[0].time,open:sub[0].open,high:Math.max(...sub.map(x=>x.high)),low:Math.min(...sub.map(x=>x.low)),close:sub.at(-1).close,volume:sub.reduce((s,b)=>s+(b.volume||0),0)})}return out}
async function getDaily(symbol){if(state.daily[symbol])return state.daily[symbol];const r=await fetch('/api/candles?market='+BY[symbol].type+'&symbol='+encodeURIComponent(symbol)+'&interval=1d',{cache:'no-store'});if(!r.ok)throw Error('Daily market data unavailable');const d=await r.json();state.daily[symbol]=normalizeBars(d.candles);return state.daily[symbol]}
function normalizeBars(raw){return(raw||[]).filter(x=>[x.time,x.open,x.high,x.low,x.close].every(exists)).map(x=>({time:n(x.time),open:n(x.open),high:n(x.high),low:n(x.low),close:n(x.close),volume:exists(x.volume)?n(x.volume):0})).sort((a,b)=>a.time-b.time)}
async function loadChart(){const my=++state.reqId,s=state.selected,tf=state.timeframe,p=BY[s];
 $('#sc-chart-loading').hidden=false;setText('#sc-chart-loading','Loading '+p.name+' candles…');state.candles=[];
 try{
  let bars;
  if(['1d','1w','1mo'].includes(tf)){const d=await getDaily(s);bars=tf==='1w'?aggregate(d,7):tf==='1mo'?aggregate(d,30):d}
  else{const r=await fetch('/api/candles?market='+p.type+'&symbol='+encodeURIComponent(s)+'&interval='+tf,{cache:'no-store'});if(!r.ok)throw Error('Candle source unavailable');bars=normalizeBars((await r.json()).candles)}
  if(my!==state.reqId)return;if(bars.length<8)throw Error('Candle history is temporarily unavailable');state.candles=bars;
  $('#sc-chart-loading').hidden=true;setText('#sc-chart-updated',(p.type==='forex'?'INDICATIVE FX':'BINANCE FUTURES')+' · '+tf.toUpperCase()+' · '+timeAt(bars.at(-1).time*1000));
  requestAnimationFrame(paintChart);
  if(s==='BTCUSDT'&&tf==='1d')updateMiniChart(bars);
 }catch(e){if(my!==state.reqId)return;setText('#sc-chart-loading',e.message||'Chart unavailable');$('#sc-chart-loading').hidden=false;setText('#sc-chart-updated','MARKET DATA UNAVAILABLE')}
}
function updateMiniChart(bars){
 const prices=bars.slice(-30).map(x=>x.close);if(prices.length<3)return;
 const low=Math.min(...prices),high=Math.max(...prices),d=Math.max(high-low,.0000001);
 const points=prices.map((v,i)=>[5+i*290/(prices.length-1),108-(v-low)/d*94]);
 const line='M'+points.map(p=>p.map(z=>z.toFixed(1)).join(',')).join(' L'),area=line+' L295,120 L5,120 Z';
 $('#sc-monthly-line').setAttribute('d',line);$('#sc-monthly-area').setAttribute('d',area);
 const c=(prices.at(-1)/prices[0]-1)*100;setText('#sc-trend-change',pct(c));$('#sc-trend-change').style.color=c>=0?'#61e29e':'#fa7184';
}
function selectSymbol(s){if(!BY[s])return;state.selected=s;state.hover=-1;const p=BY[s];setText('#sc-chart-pair',p.name);setText('#sc-chart-subtitle',p.label+' · '+(p.type==='crypto'?'Futures':'FX indicative'));$('#sc-coin').replaceChildren(scLogo(p));$('#sc-coin').classList.toggle('fx',p.type==='forex');window.SignalChartFeed?.select(p.s,state.timeframe==='1mo'?'1d':state.timeframe);if(p.type==='forex')fetch('/api/quotes?market=forex&symbol='+p.s,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{if(d?.quotes?.[p.s]){state.quotes[p.s]=d.quotes[p.s];if(state.selected===p.s)updateChartQuote()}}).catch(()=>{});const url=new URL(location.href);if(url.pathname.endsWith('/dashboard.html')||url.pathname.endsWith('/')){url.searchParams.set('pair',s);history.replaceState(null,'',url)}updateChartQuote();loadChart();closeSearch()}
function updateChartQuote(){const p=market(),q=state.quotes[p.s];setText('#sc-chart-price',q&&exists(q.price)?(p.type==='crypto'?'$':'')+num(q.price,p.digits):'—');const change=state.details[p.s]?.stats?.changePercent;
 setText('#sc-chart-change',p.type==='forex'?(q?(asof(p.s,q)==='DELAYED'?'DELAYED MARKET':'FX QUOTE'):'INDICATIVE FX'):(exists(change)?pct(change)+' (24H)':'24H CHANGE —'));
 $('#sc-chart-change').className='';if(exists(change))$('#sc-chart-change').classList.add(trend(change));
}
async function loadQuotes(){const rr=await Promise.allSettled(['crypto','forex'].map(m=>fetch('/api/quotes?market='+m,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Quote source unavailable');return r.json()})));
 for(const r of rr){if(r.status!=='fulfilled')continue;for(const [s,q] of Object.entries(r.value.quotes||{}))if(BY[s]&&exists(q.price)&&n(q.price)>0)state.quotes[s]=q}
 updateChartQuote();renderTableMarketHealth();
}
function renderTableMarketHealth(){/* Dashboard receives quote refresh even when no detail endpoint is available. */}
async function loadDetails(){const markets=MARKETS.filter(x=>x.type==='crypto').slice(0,5);const results=await Promise.allSettled(markets.map(m=>fetch('/api/market-detail?symbol='+m.s,{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(Error('24h feed unavailable')))));
 for(let i=0;i<markets.length;i++){const r=results[i];if(r.status==='fulfilled'&&r.value?.stats)state.details[markets[i].s]=r.value}
 detailStats();updateChartQuote();
}
async function initAccount(){try{
 const cfg=await fetch('/api/config',{cache:'no-store'}).then(r=>r.ok?r.json():null);if(!cfg?.authReady||!cfg.supabaseUrl||!cfg.supabaseAnonKey){renderSignalAccess();return}
 if(!window.supabase?.createClient)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';script.onload=resolve;script.onerror=reject;document.head.append(script)});
 const sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});const session=(await sb.auth.getSession()).data?.session;
 if(!session){renderSignalAccess();return}state.token=session.access_token;
 const user=session.user;const meta=user?.user_metadata||{};const rawName=meta.full_name||meta.name||user?.email?.split('@')?.[0]||'';const firstName=String(rawName).trim().split(/\s+/)[0]||'Trader';
 setText('#sc-user-name',firstName);setText('#sc-avatar',firstName[0].toUpperCase());setText('#sc-greeting','Good to see you, '+firstName+' ✦');
 try{const account=await fetch('/api/cv-ops?action=me',{cache:'no-store',headers:{Authorization:'Bearer '+session.access_token}});if(account.ok){const d=await account.json();state.account=d.account||null;const status=state.account?.status;setText('#sc-user-status',status==='trial'?'Free trial':status==='active'?'Premium':status==='administrator'?'Admin':'Member')}}catch{}
 const req=path=>fetch(path,{cache:'no-store',headers:{Authorization:'Bearer '+session.access_token}}).then(r=>r.ok?r.json():null);
 const scans=await Promise.allSettled([req('/api/crypto'),req('/api/forex')]);
 for(let i=0;i<scans.length;i++){const x=scans[i];if(x.status==='fulfilled'&&Array.isArray(x.value?.items))state.scanner[i?'forex':'crypto']=x.value.items}
 renderSignalAccess();updateHero();
 }catch{renderSignalAccess()}}
function renderSignalAccess(){const root=$('#sc-top-signals');root.replaceChildren();const joined=[...(state.scanner.crypto||[]),...(state.scanner.forex||[])].filter(x=>x.status==='QUALIFIED');
 if(!joined.length){const info=node('div','sc-signal-empty');info.append(node('strong','',state.token?'No qualified signals right now':'Your signals, all in one place'),node('small','',state.token?'Markets stay on WATCHING until scanner criteria qualify.':'Sign in to view qualified Crypto and Forex signals.'));
  const a=node('a');a.href=state.token?'/signals.html':'/account.html';a.style.cssText='display:inline-block;font-size:10px;font-weight:800;color:#ff9b6a;margin-top:8px';a.textContent=state.token?'Open scanners ↗':'Sign in / Start trial ↗';info.append(a);root.append(info);return}
 for(const m of joined.slice(0,4)){const symbol=(m.symbol||m.pair||'').replace(/[^A-Za-z]/g,'').toUpperCase(),p=BY[symbol]||MARKETS.find(k=>k.name===m.pair)||null;
  const row=node('a','sc-signal-row');row.href=p?.type==='forex'?'/forex.html':'/crypto.html';const ico=node('span','sc-small-coin'+(p?.type==='forex'?' fx':''),p?.icon||'↗');const detail=node('div','sc-signal-data');detail.append(node('strong','',m.pair||p?.name||'Market'),node('small','',exists(m.entry)?'Entry '+num(m.entry,p?.digits||4)+'   ·   Target '+(exists(m.target)?num(m.target,p?.digits||4):'—'):'Qualified research setup'));
  const tag=node('span','sc-signal-tag'+(String(m.direction||'').toUpperCase().includes('SHORT')?' short':''),m.direction||'SETUP');row.append(ico,detail,tag);root.append(row)
 }
}
function renderSearch(){const q=$('#sc-command-input').value.trim().toLowerCase(),pages=[['Dashboard','/dashboard.html'],['Trading Signals','/signals.html'],['Markets','/terminal.html'],['Analytics','/analytics.html'],['Watchlist','/watchlist.html'],['Billing','/billing.html'],['Support','/support.html'],['Account','/account.html']];state.searchResults=[...MARKETS.map(m=>({title:m.name,sub:m.type.toUpperCase(),symbol:m.s})),...pages.map(([title,url])=>({title,sub:'PAGE',url}))].filter(x=>(x.title+' '+x.sub+(x.symbol||'')).toLowerCase().includes(q)).slice(0,64);state.searchIndex=Math.min(Math.max(0,state.searchIndex),Math.max(0,state.searchResults.length-1));const root=$('#sc-command-results');root.replaceChildren();for(const [i,res] of state.searchResults.entries()){const b=node('button','sc-command-option'+(i===state.searchIndex?' current':''));b.type='button';b.dataset.scCommand=String(i);if(res.symbol&&BY[res.symbol])b.append(scLogo(BY[res.symbol]));b.append(node('strong','',res.title),node('small','',res.sub));root.append(b)}if(!state.searchResults.length)root.append(node('p','sc-muted','No matches found'))}
function openSearch(){$('#sc-command-wrap').hidden=false;$('#sc-command-input').value='';state.searchIndex=0;renderSearch();requestAnimationFrame(()=>$('#sc-command-input').focus())}
function closeSearch(){$('#sc-command-wrap').hidden=true}
function pickSearch(i){const item=state.searchResults[i];if(!item)return;if(item.symbol)selectSymbol(item.symbol);else location.href=item.url}
function sidebar(open){const bar=$('#sc-sidebar'),shade=$('#sc-shade');bar.classList.toggle('open',open);shade.hidden=!open;$('#sc-menu-toggle').setAttribute('aria-expanded',String(open));document.documentElement.style.overflow=open?'hidden':''}
function bind(){
 $('#sc-year').textContent=$('#sc-footer-year').textContent=new Date().getFullYear();
 $('#sc-search-trigger').onclick=openSearch;$('#sc-symbol-button').onclick=openSearch;$('#sc-command-close').onclick=closeSearch;
 $('#sc-command-wrap').addEventListener('click',e=>{if(e.target.matches('[data-close-command]'))closeSearch();const b=e.target.closest('[data-sc-command]');if(b)pickSearch(Number(b.dataset.scCommand))});
 $('#sc-command-input').addEventListener('input',()=>{state.searchIndex=0;renderSearch()});
 $('#sc-command-input').addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();state.searchIndex=Math.min(state.searchIndex+1,state.searchResults.length-1);renderSearch()}else if(e.key==='ArrowUp'){e.preventDefault();state.searchIndex=Math.max(0,state.searchIndex-1);renderSearch()}else if(e.key==='Enter'){e.preventDefault();pickSearch(state.searchIndex)}});
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch()}else if(e.key==='Escape'){closeSearch();sidebar(false);$('.sc-layout').classList.remove('chart-expanded');requestAnimationFrame(paintChart)}});
 $$('[data-timeframe]').forEach(b=>b.addEventListener('click',()=>{state.timeframe=b.dataset.timeframe;$$('[data-timeframe]').forEach(x=>x.classList.toggle('active',x===b));window.SignalChartFeed?.select(state.selected,state.timeframe==='1mo'?'1d':state.timeframe);loadChart()}));
 $('#sc-menu-toggle').onclick=()=>sidebar(!$('#sc-sidebar').classList.contains('open'));$('#sc-shade').onclick=()=>sidebar(false);
 $('#sc-chart-expand').onclick=()=>{const layout=$('.sc-layout'),active=layout.classList.toggle('chart-expanded');$('#sc-chart-expand').setAttribute('aria-pressed',String(active));requestAnimationFrame(paintChart)};
 window.SignalChartInteractive?.mount(); if(window.ResizeObserver)new ResizeObserver(()=>{if(state.candles.length)paintChart()}).observe(canvas);
 window.addEventListener('resize',()=>{if(innerWidth>790)sidebar(false);if(state.candles.length)paintChart()});
}
async function scCatalog(){try{const [catalog,q]=await Promise.all([fetch('/api/quotes?mode=catalog',{cache:'no-store'}).then(r=>r.json()),fetch('/api/quotes?market=crypto&all=1',{cache:'no-store'}).then(r=>r.json())]);for(const m of [...(catalog.crypto||[]),...(catalog.forex||[])]){if(!/^[A-Z0-9]{6,20}$/.test(m.symbol)||BY[m.symbol])continue;const item={s:m.symbol,name:m.name,label:m.base||m.name,base:m.base,quote:m.quote,icon:m.base?.charAt(0)||'◈',type:m.type,digits:m.type==='forex'?(m.quote==='JPY'?3:5):Math.max(2,Math.min(8,m.digits||4))};BY[m.symbol]=item;MARKETS.push(item)}for(const [symbol,quote]of Object.entries(q?.quotes||{})){if(!BY[symbol])continue;state.quotes[symbol]=quote;state.details[symbol]={stats:{changePercent:quote.changePercent,volume:quote.volume,high:quote.high,low:quote.low,lastPrice:quote.price}}}const stat=$('.sc-progress-panel .sc-subtle');if(stat)stat.textContent=MARKETS.filter(m=>m.type==='crypto').length+' crypto markets';detailStats();if(qs&&BY[qs]&&state.selected!==qs)selectSymbol(qs)}catch(e){console.warn('Catalog unavailable',e.message)}}
let latestUi=0,latestBar=0;window.addEventListener('signalchart:tick',e=>{const list=e.detail?.updates||{};for(const [symbol,q]of Object.entries(list)){if(!BY[symbol])continue;state.quotes[symbol]=q;state.details[symbol]={stats:{changePercent:q.changePercent,volume:q.volume,high:q.high,low:q.low,lastPrice:q.price}}}if(list[state.selected])updateChartQuote();if(Date.now()-latestUi>2200){latestUi=Date.now();detailStats()}});window.addEventListener('signalchart:kline',e=>{const {symbol,interval,candle,eventTime}=e.detail||{};if(!candle||symbol!==state.selected||interval!==state.timeframe||!state.candles.length)return;const last=state.candles.at(-1);if(candle.time===last.time)state.candles[state.candles.length-1]=candle;else if(candle.time>last.time){state.candles.push(candle);if(state.candles.length>240)state.candles.shift()}else return;state.quotes[symbol]={...(state.quotes[symbol]||{}),price:candle.close,asof:new Date(eventTime||Date.now()).toISOString(),stale:false};if(Date.now()-latestBar>170){latestBar=Date.now();requestAnimationFrame(paintChart);updateChartQuote();setText('#sc-chart-updated','LIVE BINANCE · '+interval+' · '+new Date(eventTime||Date.now()).toLocaleTimeString())}});

function init(){bind();updateHero();renderSignalAccess();selectSymbol(state.selected);loadQuotes();loadDetails();scCatalog();initAccount();getDaily('BTCUSDT').then(updateMiniChart).catch(()=>{});if(new URL(location.href).searchParams.get('search')==='1')requestAnimationFrame(openSearch);
 setInterval(()=>{if(!document.hidden)loadQuotes()},25000);setInterval(()=>{if(!document.hidden)loadDetails()},90000);setInterval(()=>{if(!document.hidden&&(market().type==='forex'||!window.SignalChartFeed?.state.connected))loadChart()},35000)
}
init();
})();
