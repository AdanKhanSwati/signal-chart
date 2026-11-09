'use strict';
/** Dated public economic headlines, no invented sentiment or news surprises. */
const providers=[
 {name:'Federal Reserve',url:'https://www.federalreserve.gov/feeds/press_all.xml'},
 {name:'U.S. BLS',url:'https://www.bls.gov/feed/bls_latest.rss'}
];
let cache={at:0,payload:null};
const decode=s=>String(s||'').replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim().slice(0,300);
function xmlVal(node,tag){const m=node.match(new RegExp('<(?:[a-z]+:)?'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-z]+:)?'+tag+'>','i'));return m?decode(m[1]):''}
async function get(source){
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),6500);
 try{const r=await fetch(source.url,{signal:ac.signal,cache:'no-store',headers:{Accept:'application/rss+xml,application/xml,text/xml','User-Agent':'SignalChartResearch/1.0'}});if(!r.ok)throw Error('HTTP '+r.status);const xml=await r.text();
 if(!xml.includes('<rss')&&!xml.includes('<feed')&&!xml.includes('<rdf:RDF'))throw Error('Invalid RSS');
 const nodes=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(x=>x[1]);
 const items=nodes.map(node=>{
  const title=xmlVal(node,'title'),date=xmlVal(node,'pubDate')||xmlVal(node,'date')||xmlVal(node,'updated'),url=xmlVal(node,'link'),
   stamp=Date.parse(date);
  return{title,date:Number.isFinite(stamp)?new Date(stamp).toISOString():null,source:source.name,url:url.startsWith('https://')?url:source.url,
   relatedTopics:/inflation|consumer price|employment|payroll|interest|monetary|federal funds|economic activity|GDP|labor/i.test(title)};
 }).filter(x=>x.title&&x.date&&Date.parse(x.date)>Date.now()-14*86400000&&Date.parse(x.date)<Date.now()+86400000);
 return items.slice(0,12)
 }finally{clearTimeout(timer)}
}
async function latest(){
 if(cache.payload&&Date.now()-cache.at<15*60000)return cache.payload;
 const results=await Promise.allSettled(providers.map(get)),items=[],statuses={};
 for(let i=0;i<results.length;i++){const r=results[i];statuses[providers[i].name]=r.status==='fulfilled'?'OK':'UNAVAILABLE';if(r.status==='fulfilled')items.push(...r.value)}
 const payload={checkedAt:new Date().toISOString(),providerStatus:statuses,headlines:items.sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,16),
  notice:'Headlines are attributed source records. No AI-generated bullish/bearish interpretation or unverified actual-versus-forecast surprise is implied.'};
 cache={at:Date.now(),payload};return payload
}
module.exports={latest};
