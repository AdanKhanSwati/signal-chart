(()=>{'use strict';
const $=id=>document.getElementById(id),eventBox=$('sc-calendar-events'),testForm=$('sc-backtest-form');
if(!eventBox&&!testForm)return;
const small=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e};
const when=date=>{const d=new Date(date);return Number.isNaN(d.getTime())?'Time unknown':d.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})};
const makeLink=(href,label)=>{const a=small('a','sc-srclink',label);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a};
async function getJSON(url,opts){const r=await fetch(url,{cache:'no-store',...opts});let d;try{d=await r.json()}catch{}if(!r.ok)throw Error(r.status===403?'An active membership is required':d?.error||'Service unavailable');return d}
function calendarView(d){
 const coverage=d.coverage||'UNKNOWN',st=$('sc-calendar-state');
 st.textContent=coverage==='FULL_WEEK'?'Current calendar':coverage==='PARTIAL_US'?'Partial coverage':'Sources not verified';
 st.classList.toggle('sc-research-good',coverage==='FULL_WEEK');
 st.classList.toggle('sc-research-warning',coverage!=='FULL_WEEK');
 eventBox.replaceChildren();
 const now=Date.now(),items=(d.events||[]).filter(e=>{const t=Date.parse(e.scheduledAt);return t>=now-30*60000&&t<=now+7*86400000}).slice(0,8);
 if(!items.length)eventBox.append(small('div','sc-research-empty',coverage==='FULL_WEEK'?'No upcoming listed high/medium-impact releases in the next 7 days.':'Calendar coverage is incomplete; missing events must not be treated as a safe trading window.'));
 for(const item of items){
  const card=small('div','sc-event-item');
  const left=small('div','sc-event-description'),row=small('div','sc-event-title');
  row.append(small('span','sc-event-impact '+(item.impact==='high'?'high':'medium'),item.impact.toUpperCase()));
  row.append(small('strong','',item.currency+' · '+item.title));
  left.append(row,small('time','',when(item.scheduledAt)));
  const nums=item.forecast||item.previous?small('small','sc-event-metrics','Forecast: '+(item.forecast||'—')+' · Previous: '+(item.previous||'—')):null;if(nums)left.append(nums);
  card.append(left,makeLink(item.sourceUrl||'#',item.source==='bls'?'BLS':item.source==='us'?'U.S. releases':'Forex Factory'));eventBox.append(card)
 }
 const news=$('sc-calendar-news');news.replaceChildren();
 const relevant=(d.news?.headlines||[]).filter(x=>x.relatedTopics).slice(0,3);
 if(relevant.length){
  news.append(small('div','sc-news-heading','LATEST ATTRIBUTED HEADLINES'));
  for(const a of relevant){const item=small('div','sc-news-item');item.append(small('span','',a.source+' · '+when(a.date)),makeLink(a.url,a.title));news.append(item)}
 }
 const total=Object.entries(d.providers||{}).filter(([k,v])=>v.status==='CURRENT').map(([k])=>k.toUpperCase()).join(' · ');
 $('sc-calendar-updated').textContent='Last source check '+when(d.checkedAt)+' · '+total+' · Times shown locally. Scheduled releases can change.';
}
async function calendarInit(){
 try{calendarView(await getJSON('/api/research?mode=calendar&symbol=EURUSD'))}
 catch(e){const st=$('sc-calendar-state');st.textContent='Unavailable';st.classList.add('sc-research-warning');eventBox.replaceChildren(small('div','sc-research-empty','Economic-calendar coverage could not be verified. Research setups should not be treated as event-cleared.'))}
}
async function sessionToken(){
 const c=await getJSON('/api/config');
 if(!c.authReady)throw Error('Account system is unavailable');
 if(!window.supabase?.createClient){
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=resolve;s.onerror=()=>reject(Error('Unable to load sign-in service'));document.head.append(s)})
 }
 const client=window.supabase.createClient(c.supabaseUrl,c.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
 const session=(await client.auth.getSession()).data?.session;if(!session)throw Error('Sign in to run historical validation');
 return session.access_token
}
function metric(label,value,sub){
 const e=small('div','sc-validate-metric');e.append(small('span','',label),small('strong','',value===null||value===undefined?'—':String(value)));
 if(sub)e.append(small('small','',sub));return e
}
function displayTest(d){
 const root=$('sc-backtest-results');root.replaceChildren();
 if(d.status!=='HISTORICAL_SIMULATION_ONLY'){root.append(small('p','sc-research-empty','No reproducible historical simulation available.'));return}
 const head=small('div','sc-backtest-meta');
 head.append(small('strong','',d.symbol+' · '+d.candles+' hourly candles'),small('span','',d.firstCandle?.slice(0,10)+' → '+d.lastCandle?.slice(0,10)));
 root.append(head);
 const grid=small('div','sc-validate-grid'),p=d.chronologicalHoldout;
 grid.append(metric('Chronological holdout trades',p.trades,p.insufficientSample?'Insufficient sample':''),metric('Holdout win rate',p.winRate===null?'—':p.winRate+'%'),
  metric('Average net outcome',p.avgR===null?'—':p.avgR+' R'),metric('Modeled holdout return',p.modelReturnPercent+'%','At 0.5% wallet risk / trade'),
  metric('Maximum simulated drawdown',p.maxDrawdownPercent+'%'),metric('Development sample',d.developmentSample.trades+' trades'));
 root.append(grid);
 root.append(small('p','sc-validation-note','Simulation only · '+d.market.toUpperCase()+' · Transaction costs included by model. Historical macro blackouts, funding and real broker fills were not reconstructed. '+(p.insufficientSample?'The holdout has fewer than 30 trades; no accuracy claim is justified.':'')));
 const details=document.createElement('details');details.className='sc-research-details';const sum=document.createElement('summary');sum.textContent='Methodology, limitations and provenance';details.append(sum);
 const ul=small('ul');for(const item of d.caveats||[]){ul.append(small('li','',item))}details.append(ul);
 details.append(small('code','sc-fingerprint','Data SHA-256: '+d.datasetSHA256));
 root.append(details);
 $('sc-validation-status').textContent='Calculated '+when(d.generatedAt)+' · '+d.source+' · Model '+d.modelVersion+' · Not independently audited';
}
async function runTest(event){
 event.preventDefault();const root=$('sc-backtest-results'),button=$('sc-backtest-run');
 root.replaceChildren(small('div','sc-research-empty','Fetching verified-source historical candles and simulating chronological trades…'));
 button.disabled=true;button.textContent='Running…';
 try{
  const token=await sessionToken();
  const symbol=$('sc-backtest-symbol').value,days=$('sc-backtest-days').value;
  const r=await getJSON('/api/research?mode=backtest&symbol='+encodeURIComponent(symbol)+'&days='+encodeURIComponent(days),{headers:{Authorization:'Bearer '+token}});
  displayTest(r)
 }catch(e){
  root.replaceChildren(small('div','sc-research-empty',e.message));
  if(/sign in|membership/i.test(e.message)){const a=makeLink('/account.html','Open account ↗');a.target='_self';root.append(a)}
 }finally{button.disabled=false;button.textContent='Run historical test ↗'}
}
async function schedulerInit(){
 try{
  const data=await getJSON('/api/research?mode=health'),status=data.unattendedPublishing||{},el=$('sc-scheduler-state');
  el.textContent=status.status==='RUNNING_RECENTLY'?'Recent scheduled execution':'Scheduler not verified';
  el.classList.toggle('sc-research-good',status.status==='RUNNING_RECENTLY');el.classList.toggle('sc-research-warning',status.status!=='RUNNING_RECENTLY');
  $('sc-scheduler-detail').textContent=status.status==='RUNNING_RECENTLY'?'Last authenticated scheduled job: '+when(status.lastCronRun?.lastCheckedAt):'Hourly analysis currently runs on member demand. An independently running hourly scheduler has not been verified.';
 }catch(e){$('sc-scheduler-state').textContent='Unavailable';$('sc-scheduler-detail').textContent='Scheduler status could not be loaded.'}
}
if(eventBox)calendarInit();
if(testForm){testForm.addEventListener('submit',runTest);schedulerInit();}
})();