/**
 * Read-only, source-attributed economic research for Workers Free.
 * No signal generation, automatic publishing, premium research or trading advice.
 * All URLs are fixed upstreams; user input is never used as a fetch target.
 */
const NEWS=[
 {id:'Federal Reserve',host:'federalreserve.gov',url:'https://www.federalreserve.gov/feeds/press_all.xml',home:'https://www.federalreserve.gov/newsevents/pressreleases.htm'},
 {id:'U.S. BLS',host:'bls.gov',url:'https://www.bls.gov/feed/bls_latest.rss',home:'https://www.bls.gov/news.release/'}
];
const BLS='https://www.bls.gov/schedule/news_release/bls.ics';
const FF='https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const BLS_LINK='https://www.bls.gov/schedule/news_release/';
const FF_LINK='https://www.forexfactory.com/calendar';
const HOUR=3600000,DAY=24*HOUR,MAX_FEED=350000;
const iso=ms=>new Date(ms).toISOString();
function json(data,status=200){
 return new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'
 }});
}
function clean(v,max=200){
 return String(v??'').replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]*>/g,' ')
  .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{
   const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);
   return c>31&&c<0x110000?String.fromCodePoint(c):' ';
  })
  .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'")
  .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
  .replace(/\s+/g,' ').trim().slice(0,max);
}
function tag(xml,name){
 const p=new RegExp('<(?:[a-z0-9_-]+:)?'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?'+name+'>','i');
 return clean(p.exec(xml)?.[1]||'',500);
}
function officialLink(raw,source){
 try{
  const url=new URL(raw);
  const h=url.hostname.toLowerCase();
  if(url.protocol==='https:'&&(h===source.host||h.endsWith('.'+source.host))&&
     !url.username&&!url.password&&url.href.length<=800)return url.href;
 }catch{}
 return source.home;
}
function parseNews(xml,source,now){
 if(typeof xml!=='string'||!/<(?:rss|feed|rdf:RDF)\b/i.test(xml))
  throw Error('Invalid news feed');
 const nodes=[...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)]
  .slice(0,75).map(x=>x[1]);
 return nodes.map(node=>{
  const title=tag(node,'title'),rawDate=tag(node,'pubDate')||tag(node,'updated')||
   tag(node,'published')||tag(node,'date');
  const at=Date.parse(rawDate);
  const atom=/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(node)?.[1]||'';
  const url=officialLink(tag(node,'link')||clean(atom,800),source);
  return {title,date:Number.isFinite(at)?iso(at):null,source:source.id,url,
   relatedTopics:/inflation|consumer price|employment|payroll|interest|monetary|federal funds|economic activity|gdp|labor/i.test(title)};
 }).filter(x=>x.title&&x.date&&Date.parse(x.date)>=now-14*DAY&&Date.parse(x.date)<=now+DAY)
 .slice(0,12);
}
async function fetchText(fetchFn,url){
 const response=await fetchFn(url,{method:'GET',headers:{Accept:'application/json,application/xml,text/calendar,text/plain,application/rss+xml'},
  cache:'no-store',signal:AbortSignal.timeout(6500)});
 const size=Number(response.headers.get('content-length')||0);
 if(!response.ok||(size>0&&size>MAX_FEED))throw Error('Source unavailable or too large');
 const body=await response.text();
 if(body.length>MAX_FEED)throw Error('Source exceeds bounded response size');
 return body;
}
const nyFormatter=new Intl.DateTimeFormat('en-US',{
 timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',
 hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});
function newYorkTime(raw){
 if(!/^\d{8}T\d{6}Z?$/.test(raw))return NaN;
 const year=Number(raw.slice(0,4)),month=Number(raw.slice(4,6)),
  day=Number(raw.slice(6,8)),hour=Number(raw.slice(9,11)),
  min=Number(raw.slice(11,13)),sec=Number(raw.slice(13,15));
 if(month<1||month>12||day<1||day>31||hour>23||min>59||sec>59)return NaN;
 const utc=Date.UTC(year,month-1,day,hour,min,sec);
 if(raw.endsWith('Z'))return utc;
 const parts=Object.fromEntries(nyFormatter.formatToParts(new Date(utc)).map(p=>[p.type,p.value]));
 const inNY=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
 return utc-(inNY-utc);
}
function event({title,currency,at,impact,source,sourceUrl,forecast=null,previous=null}){
 if(!Number.isFinite(at)||!title||!/^[A-Z]{3}$/.test(currency))return null;
 const t=clean(title),c=currency.toUpperCase();
 if(!t)return null;
 return {id:source+':'+c+':'+at+':'+t.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60),
  title:t,currency:c,country:c,scheduledAt:iso(at),impact,
  forecast:clean(forecast,70)||null,previous:clean(previous,70)||null,
  actual:null,source,sourceUrl,asof:null};
}
function parseBLS(ics){
 if(typeof ics!=='string'||!ics.includes('BEGIN:VCALENDAR'))throw Error('Invalid BLS calendar');
 const out=[];
 for(const raw of ics.split('BEGIN:VEVENT').slice(1,151)){
  const lines=raw.split('END:VEVENT')[0].replace(/\r?\n[ \t]/g,'').split(/\r?\n/);
  const dt=lines.find(x=>/^DTSTART(?:;|:)/.test(x))?.split(':').slice(1).join(':').trim();
  const title=clean((lines.find(x=>x.startsWith('SUMMARY:'))||'').slice(8).replace(/\\,/g,','),200);
  if(!/consumer price index|employment situation|producer price index|employment cost index|productivity|import and export|real earnings/i.test(title))continue;
  const item=event({title,currency:'USD',at:newYorkTime(dt||''),impact:'high',
   source:'bls',sourceUrl:BLS_LINK});
  if(item)out.push(item);
 }
 return out;
}
function parseFF(body){
 const rows=JSON.parse(body);
 if(!Array.isArray(rows)||rows.length>3000)throw Error('Invalid weekly event feed');
 const out=[];
 for(const row of rows.slice(0,500)){
  const impact=String(row?.impact||'').toLowerCase();
  const currency=String(row?.country||'').toUpperCase();
  const at=Date.parse(row?.date||'');
  if(!['high','medium'].includes(impact))continue;
  const item=event({title:row?.title,currency,at,impact,source:'forex',
   sourceUrl:FF_LINK,forecast:row?.forecast,previous:row?.previous});
  if(item)out.push(item);
 }
 return out;
}
function assess(calendar,symbol,now){
 if(calendar.coverage!=='FULL_WEEK')return {decision:'UNKNOWN',blocked:true,
  reason:'Economic calendar sources are incomplete; no safe event window can be asserted',
  events:[],coverage:calendar.coverage};
 const currency=symbol.endsWith('USDT')?['USD']:[symbol.slice(0,3),symbol.slice(3,6),'USD'];
 const near=calendar.events.filter(x=>{
  if(!currency.includes(x.currency))return false;
  const minutes=(Date.parse(x.scheduledAt)-now)/60000;
  return minutes<=(x.impact==='high'?60:20)&&minutes>=-(x.impact==='high'?45:15);
 });
 return {decision:near.length?'BLOCKED':'CLEAR',blocked:near.length>0,
  reason:near.length?'Scheduled high/medium-impact release window':'No listed release inside the checked event window',
  events:near.slice(0,8),coverage:calendar.coverage};
}
export function createResearch({fetchFn=globalThis.fetch,now=Date.now}={}){
 let newsCache=null,calendarCache=null;
 async function news(){
  const t=now();
  if(newsCache&&newsCache.expires>t)return newsCache.data;
  const results=await Promise.allSettled(NEWS.map(p=>fetchText(fetchFn,p.url)));
  const statuses={},headlines=[];
  for(let i=0;i<NEWS.length;i++){
   const source=NEWS[i],result=results[i];
   try{
    if(result.status!=='fulfilled')throw Error('Feed unavailable');
    headlines.push(...parseNews(result.value,source,t));
    statuses[source.id]='OK';
   }catch{statuses[source.id]='UNAVAILABLE'}
  }
  const data={checkedAt:iso(t),providerStatus:statuses,
   headlines:headlines.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,16),
   notice:'Source-attributed headlines only. No inferred market sentiment or unverified release surprise.'};
  newsCache={data,expires:t+(Object.values(statuses).every(x=>x==='OK')?15*60000:2*60000)};
  return data;
 }
 async function calendar(){
  const t=now();
  if(calendarCache&&calendarCache.expires>t)return calendarCache.data;
  const inputs=[{id:'bls',url:BLS,parse:parseBLS},{id:'forex',url:FF,parse:parseFF}];
  const results=await Promise.allSettled(inputs.map(p=>fetchText(fetchFn,p.url)));
  const providers={},events=[];
  for(let i=0;i<inputs.length;i++){
   const input=inputs[i],result=results[i];
   let items=[],failure=false;
   try{
    if(result.status!=='fulfilled')throw Error('Feed unavailable');
    items=input.parse(result.value);
   }catch{failure=true}
   const upcoming=items.filter(e=>Date.parse(e.scheduledAt)>=t-3*DAY&&
    Date.parse(e.scheduledAt)<=t+35*DAY);
   const current=input.id==='forex'
    ?items.some(e=>Date.parse(e.scheduledAt)>=t-2*HOUR&&Date.parse(e.scheduledAt)<=t+8*DAY)
    :upcoming.length>0;
   const status=failure?'UNAVAILABLE':current?'CURRENT':'STALE_OR_EMPTY';
   providers[input.id]={status,count:items.length,upcoming:upcoming.length,url:input.url};
   if(current)events.push(...upcoming);
  }
  const dedup=new Map();
  for(const e of events){
   const key=e.currency+':'+e.scheduledAt+':'+e.title.toLowerCase().replace(/[^a-z]/g,'').slice(0,12);
   if(!dedup.has(key)||e.source==='bls')dedup.set(key,e);
  }
  const listed=[...dedup.values()].sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)).slice(0,250);
  const bls=providers.bls.status==='CURRENT',fx=providers.forex.status==='CURRENT';
  const coverage=bls&&fx?'FULL_WEEK':bls?'PARTIAL_US':'UNKNOWN';
  const data={checkedAt:iso(t),coverage,providers,events:listed,
   highCount:listed.filter(x=>x.impact==='high').length,
   notes:'Missing or stale economic sources are not interpreted as zero events. Calendar times and releases may change.'};
  calendarCache={data,expires:t+(bls&&fx?14*60000:2*60000)};
  return data;
 }
 return async function handleResearch(request){
  if(request.method!=='GET')return json({error:'GET only'},405);
  const q=new URL(request.url).searchParams,mode=q.get('mode')||'calendar';
  if(mode==='health')return json({status:'RESEARCH_ONLY',checkedAt:iso(now()),
   unattendedPublishing:{enabled:false,configured:false,status:'NOT_READY',
    note:'Unattended premium signal generation has not been validated or activated.'},
   marketSignals:'PROTECTED_SERVER_UNLOCK',paymentCollection:'DISABLED_DURING_MIGRATION'});
  if(mode==='backtest')return json({error:'Historical simulation is unavailable during Cloudflare migration.'},503);
  if(mode==='news')return json(await news());
  if(mode!=='calendar')return json({error:'Unknown research mode'},404);
  const [eventsResult,headlinesResult]=await Promise.allSettled([calendar(),news()]);
  const events=eventsResult.status==='fulfilled'?eventsResult.value:{
   checkedAt:iso(now()),coverage:'UNKNOWN',providers:{},events:[],highCount:0,
   notes:'Calendar sources unavailable; trading windows are not cleared.'};
  const headlines=headlinesResult.status==='fulfilled'?headlinesResult.value:{
   checkedAt:iso(now()),headlines:[],providerStatus:{},notice:'News sources unavailable'};
  const symbol=String(q.get('symbol')||'EURUSD').toUpperCase();
  const valid=/^(?:[A-Z]{6}|[A-Z0-9]{3,20}USDT)$/.test(symbol);
  return json({...events,news:headlines,
   assessment:valid?assess(events,symbol,now()):null});
 };
}
