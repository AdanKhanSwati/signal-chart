'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const modulePromise=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/research.mjs')).href);
const NOW=Date.parse('2026-11-11T08:00:00Z');
const bls=['BEGIN:VCALENDAR','BEGIN:VEVENT',
 'DTSTART;TZID=America/New_York:20261113T083000',
 'SUMMARY:Consumer Price Index','END:VEVENT','END:VCALENDAR'].join('\n');
const ff=JSON.stringify([{title:'ECB Rate Statement',country:'EUR',impact:'High',
 date:'2026-11-12T12:00:00Z',forecast:'2%',previous:'2.5%'}]);
const fed='<rss><channel><item><title>Federal Reserve monetary policy update</title>'+
 '<pubDate>Tue, 10 Nov 2026 12:00:00 GMT</pubDate>'+
 '<link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261110a.htm</link>'+
 '</item></channel></rss>';
const rss='<rss><channel><item><title>Consumer price index release</title>'+
 '<pubDate>Tue, 10 Nov 2026 12:00:00 GMT</pubDate>'+
 '<link>https://evil.example/phishing</link></item></channel></rss>';
const upstream=new Map([
 ['https://www.bls.gov/schedule/news_release/bls.ics',bls],
 ['https://nfs.faireconomy.media/ff_calendar_thisweek.json',ff],
 ['https://www.federalreserve.gov/feeds/press_all.xml',fed],
 ['https://www.bls.gov/feed/bls_latest.rss',rss]
]);
function mock({map=upstream,calls=[]}={}){
 return async url=>{
  calls.push(url);
  if(!map.has(url))return new Response('down',{status:503});
  return new Response(map.get(url),{status:200,headers:{'Content-Type':'text/plain'}});
 };
}
async function handler(options={}){
 const mod=await modulePromise;
 return mod.createResearch({fetchFn:options.fetchFn||mock(options),now:()=>NOW});
}
const req=(mode='calendar',symbol='EURUSD',method='GET')=>new Request(
 'https://staging.example.test/api/research?mode='+mode+'&symbol='+symbol,{method});
test('health is explicitly research-only and requires no network',async()=>{
 const calls=[],h=await handler({calls});
 const res=await h(req('health'));
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.unattendedPublishing.enabled,false);
 assert.equal(data.paymentCollection,'DISABLED_DURING_MIGRATION');
 assert.equal(calls.length,0);
});
test('calendar merges attributed current sources and news with official links',async()=>{
 const calls=[],h=await handler({calls});
 const res=await h(req());
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.coverage,'FULL_WEEK');
 assert.equal(data.events.length,2);
 assert.equal(data.events[0].source,'forex');
 assert.equal(data.events[0].sourceUrl,'https://www.forexfactory.com/calendar');
 assert.equal(data.events[1].source,'bls');
 assert.equal(data.events[1].sourceUrl,'https://www.bls.gov/schedule/news_release/');
 assert.equal(data.assessment.decision,'CLEAR');
 assert.equal(data.news.headlines.length,2);
 assert.equal(data.news.headlines.find(x=>x.source==='U.S. BLS').url,'https://www.bls.gov/news.release/');
 assert.equal(calls.length,4);
});
test('source outage fails closed without fabricated events or verified coverage',async()=>{
 const h=await handler({map:new Map()});
 const res=await h(req());
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.coverage,'UNKNOWN');
 assert.deepEqual(data.events,[]);
 assert.equal(data.assessment.blocked,true);
 assert.equal(data.assessment.decision,'UNKNOWN');
 assert.deepEqual(data.news.headlines,[]);
 assert.equal(data.providers.bls.status,'UNAVAILABLE');
});
test('a single BLS source is partial coverage, not a cleared global calendar',async()=>{
 const h=await handler({map:new Map([['https://www.bls.gov/schedule/news_release/bls.ics',bls]])});
 const data=await (await h(req())).json();
 assert.equal(data.coverage,'PARTIAL_US');
 assert.equal(data.assessment.blocked,true);
});
test('Atom link href is recognized and off-domain links are replaced with official homepage',async()=>{
 const atom='<feed><entry><title>Monetary policy update</title>'+
 '<updated>2026-11-10T12:00:00Z</updated>'+
 '<link href="https://www.federalreserve.gov/newsevents/pressreleases/test.htm"/></entry></feed>';
 const h=await handler({map:new Map([
 ['https://www.federalreserve.gov/feeds/press_all.xml',atom],
 ['https://www.bls.gov/feed/bls_latest.rss',rss]
 ])});
 const data=await (await h(req('news'))).json();
 assert.equal(data.headlines[0].url,'https://www.federalreserve.gov/newsevents/pressreleases/test.htm');
 assert.equal(data.headlines[1].url,'https://www.bls.gov/news.release/');
});
test('stale headlines are omitted rather than presented as current',async()=>{
 const stale=fed.replace('Tue, 10 Nov 2026','Thu, 01 Oct 2026');
 const h=await handler({map:new Map([['https://www.federalreserve.gov/feeds/press_all.xml',stale]])});
 const data=await (await h(req('news'))).json();
 assert.equal(data.headlines.length,0);
});
test('oversized and malformed feeds are never interpreted as valid calendars',async()=>{
 const map=new Map(upstream);map.set('https://nfs.faireconomy.media/ff_calendar_thisweek.json','x'.repeat(350001));
 const h=await handler({map});
 const data=await (await h(req())).json();
 assert.equal(data.coverage,'PARTIAL_US');
 assert.equal(data.providers.forex.status,'UNAVAILABLE');
});
test('calendar caches source responses within a Worker instance',async()=>{
 const calls=[],h=await handler({calls});
 await h(req());await h(req());
 assert.equal(calls.length,4);
});
test('unsupported actions never fetch upstream or run paid backtests',async()=>{
 const calls=[],h=await handler({calls});
 assert.equal((await h(req('calendar','EURUSD','POST'))).status,405);
 assert.equal((await h(req('backtest'))).status,503);
 assert.equal((await h(req('does_not_exist'))).status,404);
 assert.equal(calls.length,0);
});
test('malformed research symbol never produces a false safe-window assessment',async()=>{
 const h=await handler();
 const data=await (await h(req('calendar','NOT-A-SYMBOL'))).json();
 assert.equal(data.assessment,null);
});

test('Cloudflare Worker routes public research and rejects premium backtest without Supabase',async()=>{
 const workerModule=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
 const worker=workerModule.createWorker({fetchFn:mock()});
 const health=await worker.fetch(req('health'),{});
 assert.equal(health.status,200);
 assert.equal((await health.json()).unattendedPublishing.enabled,false);
 const news=await worker.fetch(req('news'),{});
 assert.equal(news.status,200);
 assert.equal((await news.json()).headlines.length,2);
 const backtest=await worker.fetch(req('backtest'),{});
 assert.equal(backtest.status,503);
});

test('expired weekly Forex Factory entries never certify FULL_WEEK coverage',async()=>{
 const stale=JSON.stringify([{title:'Old rate release',country:'EUR',impact:'High',
  date:'2026-11-06T12:00:00Z'}]);
 const map=new Map(upstream);
 map.set('https://nfs.faireconomy.media/ff_calendar_thisweek.json',stale);
 const h=await handler({map});
 const data=await (await h(req())).json();
 assert.equal(data.coverage,'PARTIAL_US');
 assert.equal(data.assessment.decision,'UNKNOWN');
 assert.equal(data.providers.forex.status,'STALE_OR_EMPTY');
});
