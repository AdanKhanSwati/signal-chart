
(()=>{'use strict';
const q=s=>document.querySelector(s),show=(s,v)=>{const n=q(s);if(n)n.hidden=!v};
const message=(s,bad=false)=>{const x=q('#v2-status');if(!x)return;x.textContent=s||'';x.classList.toggle('error',bad)};
const money=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{maximumFractionDigits:6}):'—';
const date=s=>s?new Date(s).toLocaleString():'—';
let sb=null;
async function token(){const {data,error}=await sb.auth.getSession();if(error)throw error;return data?.session?.access_token||null}
function panel(name,value){
const d=document.createElement('div'),sm=document.createElement('small'),s=document.createElement('strong');
sm.textContent=name;s.textContent=value??'—';d.append(sm,s);return d;
}
function paint(items){
const el=q('#crypto-cards');el.replaceChildren();
for(const m of items){
 const card=document.createElement('article');card.className='cv-crypto-card';
 const header=document.createElement('div');header.className='cv-crypto-title';
 const h=document.createElement('h3');h.textContent=m.pair||m.symbol;
 const badge=document.createElement('span');badge.className='cv-crypto-badge'+(m.status==='QUALIFIED'?' cv-qualified':'');badge.textContent=m.status||'UNAVAILABLE';
 header.append(h,badge);card.append(header);
 const explanation=document.createElement('p');explanation.className='cv-crypto-reason';explanation.textContent=m.reason||'Market data currently unavailable';card.append(explanation);
 const stats=document.createElement('div');stats.className='cv-crypto-stats';
 for(const [label,val] of [['Market close',money(m.lastPrice)],['Direction',m.direction||'—'],['Entry',money(m.entry)],['Stop-loss',money(m.stop)],['Take-profit',money(m.target)],['RSI 14',money(m.rsi14)]])stats.append(panel(label,val));
 card.append(stats);
 const time=document.createElement('p');time.className='cv-crypto-muted';time.textContent='Closed candle: '+date(m.candleTime);card.append(time);
 const a=document.createElement('a');a.className='cv-mini-link';a.href='/terminal.html?pair='+encodeURIComponent(m.symbol);a.textContent='View matching market chart →';card.append(a);
 el.append(card);
}
if(!items.length){el.textContent='No crypto scanner results available.'}
}
async function scan(){
const btn=q('#crypto-refresh');if(btn)btn.disabled=true;
message('Scanning closed cryptocurrency candles…');
try{
 const t=await token();if(!t){show('#crypto-locked',true);show('#crypto-scanner',false);message('Please sign in to access crypto research.');return}
 const response=await fetch('/api/crypto',{headers:{Authorization:'Bearer '+t},cache:'no-store',credentials:'same-origin'});
 const data=await response.json().catch(()=>({}));
 if(response.status===401||response.status===403){show('#crypto-locked',true);show('#crypto-scanner',false);message(data.error||'Your crypto research access is locked.',true);return}
 if(!response.ok)throw Error(data.error||'Scanner temporarily unavailable.');
 show('#crypto-locked',false);show('#crypto-scanner',true);
 paint(data.items||[]);
 q('#crypto-updated').textContent='Last checked '+date(data.generatedAt)+' · '+(data.items||[]).filter(x=>x.status==='QUALIFIED').length+' qualified research setup(s)';
 message('');
}catch(e){message(e.message||'Scanner unavailable.',true)}finally{if(btn)btn.disabled=false}
}
async function init(){
try{
 const config=await fetch('/api/config',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Authentication configuration unavailable');return r.json()});
 if(!config.authReady||!config.supabaseUrl||!config.supabaseAnonKey)throw Error('Supabase authentication is not configured');
 await new Promise((resolve,reject)=>{if(window.supabase?.createClient)return resolve();const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=resolve;s.onerror=()=>reject(Error('Authentication library unavailable'));document.head.append(s)});
 sb=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
 const t=await token();if(t){const sign=q('#signout');if(sign){sign.hidden=false;sign.onclick=async()=>{await sb.auth.signOut();location.href='/account.html'};}}
 q('#crypto-refresh').addEventListener('click',scan);await scan();
}catch(e){show('#crypto-locked',true);message(e.message||'Unable to load the crypto scanner.',true)}
}
init();
})();
