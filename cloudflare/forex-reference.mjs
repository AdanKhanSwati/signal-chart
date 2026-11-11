/**
 * Read-only daily FX reference prices for Cloudflare Workers Free.
 * Frankfurter blended rates are NOT broker quotes, execution prices,
 * price feeds suitable for signals, or interval OHLC candles.
 * Crosses are exact ratios of the same dated USD-base provider snapshot.
 */
import {FOREX} from './market-catalog.mjs';
const FOREX_SET=new Set(FOREX);
const CACHE={data:null,expires:0,status:200};
const fail=(status,error)=>new Response(JSON.stringify({error}),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
function reply(data){
 return new Response(JSON.stringify(data),{headers:{
  'content-type':'application/json; charset=utf-8',
  'cache-control':'public,max-age=300,s-maxage=900',
  'X-Content-Type-Options':'nosniff'
 }});
}
export async function getForexReferences(request,{fetchFn=globalThis.fetch,now=Date.now}={}){
 if(request.method!=='GET')return fail(405,'GET only');
 const q=new URL(request.url).searchParams;
 if(q.get('market')!=='forex')return fail(503,'Crypto quotes are not yet migrated');
 const selection=q.get('symbol');
 if(selection&&!FOREX_SET.has(selection))return fail(400,'Unsupported FX symbol');
 if(CACHE.data&&CACHE.expires>now()){
  if(CACHE.status!==200)return fail(502,'Daily reference rates temporarily unavailable');
  return reply(selection?{...CACHE.data,quotes:
   {[selection]:CACHE.data.quotes[selection]||null}}:CACHE.data);
 }
 try{
  const r=await fetchFn('https://api.frankfurter.dev/v1/latest?base=USD',{
   method:'GET',headers:{Accept:'application/json'},cache:'no-store',
   signal:AbortSignal.timeout(4500)
  });
  const length=Number(r.headers.get('content-length')||0);
  if(!r.ok||(length>0&&length>120000))throw Error('No daily FX reference rates');
  const text=await r.text();
  if(text.length>120000)throw Error('Daily FX response too large');
  const data=JSON.parse(text);
  if(data?.base!=='USD'||!/^\d{4}-\d{2}-\d{2}$/.test(String(data?.date))||
     typeof data.rates!=='object'||!data.rates||Array.isArray(data.rates))
   throw Error('Invalid daily FX response');
  const rates={USD:1};
  for(const [code,val]of Object.entries(data.rates)){
   if(!/^[A-Z]{3}$/.test(code)||!Number.isFinite(Number(val))||Number(val)<=0)
    continue;
   rates[code]=Number(val);
  }
  const quotes={};
  for(const symbol of FOREX){
   const base=symbol.slice(0,3),quote=symbol.slice(3);
   if(!(rates[base]>0)||!(rates[quote]>0))continue;
   const price=rates[quote]/rates[base];
   if(!Number.isFinite(price)||price<=0)continue;
   quotes[symbol]={
    price,asof:data.date+'T00:00:00Z',referenceDate:data.date,
    source:'Frankfurter blended daily currency reference',reference:true,
    indicative:true,tradable:false,stale:true,
    bid:null,ask:null,changePercent:null
   };
  }
  if(Object.keys(quotes).length<5)throw Error('Missing cross currency coverage');
  const response={
   market:'forex',source:'Frankfurter blended official-source daily reference',
   referenceDate:data.date,referenceOnly:true,tradable:false,
   note:'Not real-time trading prices. Not suitable for entering trades, stop-loss calculations, or generating signals.',
   quotes
  };
  CACHE.data=response;CACHE.expires=now()+900000;CACHE.status=200;
  return reply(selection?{...response,quotes:{[selection]:quotes[selection]||null}}:response);
 }catch{
  CACHE.data={};CACHE.status=502;CACHE.expires=now()+45000;
  return fail(502,'Daily reference rates temporarily unavailable');
 }
}
