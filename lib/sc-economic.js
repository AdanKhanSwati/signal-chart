'use strict';
/** Dated economic event research: official BLS and attributed weekly Forex Factory feed.
 * Missing / stale calendars are explicit UNKNOWN and cannot be treated as safe.
 */
let mem={at:0,data:null};
const minute=60000,hour=3600000;
const SOURCE={
 bls:{name:'U.S. Bureau of Labor Statistics',url:'https://www.bls.gov/schedule/news_release/bls.ics'},
 forex:{name:'Forex Factory weekly calendar',url:'https://nfs.faireconomy.media/ff_calendar_thisweek.json'},
 us:{name:'U.S. release calendar (Xoomar)',url:'https://xoomar.com/api/markets/calendar?importance=high'}
};
function text(v){return typeof v==='string'?v.trim().slice(0,200):''}
async function get(url,ms=8500){const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),ms);
 try{const r=await fetch(url,{signal:ac.signal,headers:{Accept:'application/json,text/calendar,text/plain,*/*','User-Agent':'SignalChartResearch/1.0'},cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return r.text()}finally{clearTimeout(timer)}
}
function localNY(raw){
 if(/^\d{8}T\d{6}Z$/.test(raw))return Date.UTC(+raw.slice(0,4),+raw.slice(4,6)-1,+raw.slice(6,8),+raw.slice(9,11),+raw.slice(11,13),+raw.slice(13,15));
 if(!/^\d{8}T\d{6}$/.test(raw))return NaN;
 const y=+raw.slice(0,4),mo=+raw.slice(4,6),d=+raw.slice(6,8),h=+raw.slice(9,11),min=+raw.slice(11,13),sec=+raw.slice(13,15);
 const utc=Date.UTC(y,mo-1,d,h,min,sec),fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const parts=Object.fromEntries(fmt.formatToParts(new Date(utc)).map(v=>[v.type,v.value]));
 const nyUTC=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
 return utc-(nyUTC-utc)
}
function normalize({title,currency,when,impact,source,forecast=null,previous=null,actual=null,url=null}){
 const t=Date.parse(when instanceof Date?when.toISOString():when);
 if(!Number.isFinite(t)||!title)return null;
 return {id:source+':'+currency+':'+t+':'+text(title).toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60),title:text(title),currency,country:currency,scheduledAt:new Date(t).toISOString(),impact:impact||'high',forecast:text(forecast)||null,previous:text(previous)||null,actual:text(actual)||null,source,sourceUrl:url||SOURCE[source]?.url||null,asof:null};
}
function blsParser(ics){
 const out=[];if(typeof ics!=='string'||!ics.includes('BEGIN:VCALENDAR'))throw Error('Invalid official ICS feed');
 for(const raw of ics.split('BEGIN:VEVENT').slice(1)){
  const event=raw.split('END:VEVENT')[0].replace(/\r?\n[ \t]/g,''),lines=event.split(/\r?\n/);
  const d=lines.find(x=>x.startsWith('DTSTART'))||'',dt=d.split(':').slice(1).join(':').trim();
  const ms=localNY(dt);if(!Number.isFinite(ms))continue;
  const title=(lines.find(x=>x.startsWith('SUMMARY:'))||'').slice(8).replace(/\\,/g,',').replace(/\\n/g,' ');
  if(!title)continue;
  const major=/consumer price index|employment situation|producer price index|employment cost index|productivity|import and export|real earnings/i.test(title);
  if(!major)continue;
  const item=normalize({title,currency:'USD',when:new Date(ms),impact:'high',source:'bls',url:'https://www.bls.gov/schedule/news_release/'});
  if(item)out.push(item)
 }
 return out;
}
function parseFF(s){
 const rows=JSON.parse(s);if(!Array.isArray(rows))throw Error('Unexpected weekly calendar format');
 const out=[];
 for(const v of rows){
  if(!v?.date||!v?.title||!v?.country||!/^(high|medium)$/i.test(String(v.impact)))continue;
  const item=normalize({title:v.title,currency:String(v.country).toUpperCase(),when:v.date,impact:String(v.impact).toLowerCase(),source:'forex',forecast:v.forecast,previous:v.previous});
  if(item)out.push(item)
 }
 return out;
}
function parseUS(s){
 const obj=JSON.parse(s),rows=Array.isArray(obj)?obj:obj?.data;
 if(!Array.isArray(rows))throw Error('US calendar not valid');
 const out=[];
 for(const v of rows){
  const item=normalize({title:v.eventName||v.title,currency:'USD',when:v.scheduledAt||v.date,impact:v.importance||'high',source:'us',forecast:v.forecast,previous:v.previous,actual:v.actual,url:'https://xoomar.com/economic-calendar-api'});
  if(item)out.push(item)
 }
 return out;
}
async function snapshot(force=false){
 if(!force&&mem.data&&Date.now()-mem.at<14*minute)return mem.data;
 const now=Date.now(),results=await Promise.allSettled([get(SOURCE.bls.url),get(SOURCE.forex.url),get(SOURCE.us.url)]);
 const names=['bls','forex','us'],parsers=[blsParser,parseFF,parseUS],providers={},all=[];
 for(let i=0;i<results.length;i++){
  let items=[],reason=null;try{if(results[i].status!=='fulfilled')throw results[i].reason;items=parsers[i](results[i].value)}catch(e){reason=String(e?.message||e).slice(0,90)}
  const upcoming=items.filter(e=>Date.parse(e.scheduledAt)>=now-3*24*hour&&Date.parse(e.scheduledAt)<=now+35*24*hour);
  const currentWeek=items.some(e=>{const t=Date.parse(e.scheduledAt);return t>=now-7*24*hour&&t<=now+8*24*hour});
  const valid=names[i]==='forex'?currentWeek:upcoming.length>0;
  providers[names[i]]={status:valid?'CURRENT':reason?'UNAVAILABLE':'STALE_OR_EMPTY',count:items.length,upcoming:upcoming.length,url:SOURCE[names[i]].url,reason};
  if(valid)all.push(...upcoming)
 }
 const unique=new Map();
 for(const event of all){const key=event.currency+':'+Math.round(Date.parse(event.scheduledAt)/minute)+':'+event.title.toLowerCase().replace(/[^a-z]/g,'').slice(0,12);
  if(!unique.has(key)||event.source==='bls')unique.set(key,event)
 }
 const events=[...unique.values()].sort((a,b)=>Date.parse(a.scheduledAt)-Date.parse(b.scheduledAt));
 const ffOk=providers.forex.status==='CURRENT',usOk=providers.bls.status==='CURRENT'||providers.us.status==='CURRENT';
 const coverage=ffOk?'FULL_WEEK':usOk?'PARTIAL_US':'UNKNOWN';
 const data={checkedAt:new Date(now).toISOString(),coverage,providers,events,highCount:events.filter(e=>e.impact==='high').length,notes:'High-impact safety windows are applied before approving research setups. Missing or stale economic sources are NOT interpreted as zero events.'};
 mem={at:now,data};return data
}
function assess(calendar,symbol,at=Date.now(),preMinutes=60,postMinutes=45){
 const market=symbol.endsWith('USDT')?'crypto':'forex',needed=market==='crypto'?['USD']:[symbol.slice(0,3),symbol.slice(3,6),'USD'];
 const full=calendar?.coverage==='FULL_WEEK';
 if(!full)return {decision:'UNKNOWN',blocked:true,reason:'Economic calendar not fully verified for current week',events:[],coverage:calendar?.coverage||'UNKNOWN'};
 const near=(calendar.events||[]).filter(e=>{
  if(!needed.includes(e.currency))return false;
  const minutes=(Date.parse(e.scheduledAt)-at)/minute;
  const pre=e.impact==='high'?preMinutes:20,post=e.impact==='high'?postMinutes:15;
  return minutes<=pre&&minutes>=-post
 });
 return{decision:near.length?'BLOCKED':'CLEAR',blocked:near.length>0,reason:near.length?'High-impact event window':'No listed high/medium impact releases inside event window',events:near.slice(0,8),coverage:calendar.coverage}
}
module.exports={snapshot,assess,parseFF,parseUS,blsParser};
