'use strict';
// Public, read-only staging smoke; no passwords, cookies, server keys,
// payment requests, premium unlocks or private customer data.
const ORIGIN='https://signal-chart.auxwork3.workers.dev';
const endpoints=Object.freeze([
 {id:'health',path:'/api/health',expected:200,type:'health'},
 {id:'readiness',path:'/api/ready',expected:503,type:'readiness'},
 {id:'rootLanding',path:'/',expected:200,type:'landing'},
 {id:'landingAsset',path:'/launch.html',expected:200,type:'landing'},
 {id:'mobileApp',path:'/app.html',expected:200,type:'app'},
 {id:'adminLoginPage',path:'/admin-login.html',expected:200,type:'adminLogin'},
 {id:'adminAuthGuard',path:'/api/admin-session',expected:401,type:'adminGuard'},
 {id:'adminConsole',path:'/ops.html',expected:200,type:'adminConsole'},
 {id:'adminConsoleScript',path:'/ops-console.js',expected:200,type:'adminScript'},
 {id:'adminOverviewGuard',path:'/api/admin-overview',expected:401,type:'adminGuard'},
 {id:'marketingMarkets',path:'/markets.html',expected:200,type:'marketing'},
 {id:'marketingPlatform',path:'/platform.html',expected:200,type:'marketing'},
 {id:'marketingResearch',path:'/research.html',expected:200,type:'marketing'},
 {id:'marketingMembership',path:'/membership.html',expected:200,type:'marketing'},
 {id:'marketDirectory',path:'/api/markets',expected:200,type:'markets'},
 {id:'cryptoBTC',path:'/api/candles?market=crypto&symbol=BTCUSDT&interval=1h',expected:200,type:'candles'},
 {id:'cryptoADA',path:'/api/candles?market=crypto&symbol=ADAUSDT&interval=1h',expected:200,type:'candles'},
 {id:'forexEUR',path:'/api/candles?market=forex&symbol=EURUSD&interval=15m',expected:200,type:'candles'}
]);
async function probe(item,fetchFn){
 try{
  const res=await fetchFn(ORIGIN+item.path,{
   method:'GET',headers:{Accept:item.type==='adminScript'?'text/javascript':item.type==='landing'||item.type==='app'||item.type==='marketing'||item.type==='adminLogin'||item.type==='adminConsole'?'text/html':'application/json'},
   redirect:'error',signal:AbortSignal.timeout(11000),cache:'no-store'
  });
  if(res.status!==item.expected)return {id:item.id,status:res.status,result:'UNEXPECTED_HTTP'};
  if(item.type==='adminScript'){
   const js=(await res.text()).slice(0,100000);
   return {id:item.id,status:res.status,result:js.includes('signalchart-superadmin-auth-v1')&&js.includes('/api/admin-overview')?'PASS':'INCOMPLETE_ADMIN_SCRIPT'};
  }
  if(item.type==='landing'||item.type==='app'||item.type==='marketing'||item.type==='adminLogin'||item.type==='adminConsole'){
   const html=(await res.text()).slice(0,250000);
   if(!html.includes('SignalChart'))return {id:item.id,status:res.status,result:'UNEXPECTED_CONTENT'};
   if(item.type==='adminConsole')return {id:item.id,status:res.status,result:html.includes('id="op-app" hidden')&&html.includes('src="/ops-console.js"')&&html.includes('PRIVATE OPERATIONS')?'PASS':'INCOMPLETE_ADMIN_CONSOLE'};
   if(item.type==='adminLogin')return {id:item.id,status:res.status,result:html.includes('id="admin-form"')&&html.includes('src="/admin-auth.js"')&&html.includes('noindex,nofollow')?'PASS':'INCOMPLETE_ADMIN_LOGIN'};
   if(item.type==='marketing')return {id:item.id,status:res.status,result:html.includes('<main id="main">')&&html.includes('aria-current="page"')?'PASS':'INCOMPLETE_PAGE'};
   const isNew=html.includes('Trade with<br><span>market context.');
   return {id:item.id,status:res.status,result:item.type==='landing'&&!isNew?'OLD_DEPLOYMENT':'PASS'};
  }
  const data=await res.json();
  if(item.type==='adminGuard')return {id:item.id,status:res.status,result:typeof data.error==='string'&&/sign in required/i.test(data.error)?'PASS':'UNSAFE_ADMIN_GATE'};
  if(item.type==='health')return {id:item.id,status:res.status,result:data.ok===true?'PASS':'UNEXPECTED_CONTENT'};
  if(item.type==='readiness')return {id:item.id,status:res.status,result:data.productionReady===false?'PASS':'UNSAFE_READINESS'};
  if(item.type==='markets')return {id:item.id,status:res.status,result:Array.isArray(data.markets)&&data.markets.length>=30?'PASS':'CATALOG_INCOMPLETE',
   count:Array.isArray(data.markets)?data.markets.length:null};
  const valid=Array.isArray(data.candles)&&data.candles.length>=12&&typeof data.source==='string';
  // A USD spot reference is useful for a public chart but does not prove
  // USDT perpetual-market coverage or suitability for automated signals.
  const referenceOnly=valid&&(
   (item.id.startsWith('crypto')&&
    (data.instrument!=='perpetual'||data.aliasOnly===true||
     !['binance','bybit','okx'].includes(String(data.exchange||'').toLowerCase())))||
   (item.id.startsWith('forex')&&
    (data.instrument!=='historical_fx'&&data.instrument!=='indicative_fx'))
  );
  return {id:item.id,status:res.status,
   result:!valid?'INVALID_HISTORY':referenceOnly?'REFERENCE_ONLY':'PASS',
   instrument:valid?String(data.instrument||'unknown').slice(0,24):undefined,
   exchange:valid?String(data.exchange||'none').slice(0,20):undefined,
   count:valid?data.candles.length:0};
 }catch{
  // No raw network error text, provider URLs, internal keys or response bodies.
  return {id:item.id,status:null,result:'UNREACHABLE'};
 }
}
async function runSmoke({fetchFn=globalThis.fetch}={}){
 const result=await Promise.all(endpoints.map(item=>probe(item,fetchFn)));
 const passing=result.filter(x=>x.result==='PASS').length;
 const releaseSafe=result.every(x=>x.result==='PASS');
 return {base:ORIGIN,checks:result,passed:passing,total:result.length,
  verdict:releaseSafe?'PUBLIC_SMOKE_PASSED':'STAGING_REQUIRES_ATTENTION',
  note:'Public smoke only. Passing does not approve paid trading signals, billing or DNS cutover.'};
}
module.exports={runSmoke,endpoints};
if(require.main===module)runSmoke().then(r=>{
 process.stdout.write('SIGNALCHART_LIVE_SMOKE '+JSON.stringify(r)+'\n');
}).catch(()=>{process.stdout.write('SIGNALCHART_LIVE_SMOKE {"verdict":"SMOKE_RUN_FAILED"}\n')});
