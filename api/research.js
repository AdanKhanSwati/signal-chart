'use strict';
/** Read-only source-attributed news/calendar and paid-only research backtesting.
 * Unattended signal publishing intentionally remains disabled until independently validated. */
function createHandler({
 calendar=require('../lib/sc-economic'),news=require('../lib/sc-news'),
 backtest=require('../lib/sc-backtest'),core=require('../lib/candriva-core'),
 clock=()=>Date.now()
}={}){
 return async function(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET')return res.status(405).json({error:'GET only'});
  const mode=String(req.query?.mode||'calendar');
  try{
   if(mode==='health')return res.status(200).json({
    status:'RESEARCH_ONLY',checkedAt:new Date(clock()).toISOString(),
    unattendedPublishing:{enabled:false,configured:false,status:'NOT_READY',
     note:'Unattended hourly premium signal generation has not been verified or activated.'},
    marketSignals:'PROTECTED_SERVER_UNLOCK',paymentCollection:'MANUAL_ADMIN_VERIFICATION'});
   if(mode==='news'){
    const result=await news.latest();
    return res.status(200).json(result);
   }
   if(mode==='calendar'){
    const [calendarResult,newsResult]=await Promise.allSettled([calendar.snapshot(),news.latest()]);
    const events=calendarResult.status==='fulfilled'?calendarResult.value:{
     checkedAt:new Date(clock()).toISOString(),coverage:'UNKNOWN',providers:{},events:[],
     notes:'Economic calendar providers are unavailable. Do not infer a safe trading window.'};
    const headlines=newsResult.status==='fulfilled'?newsResult.value:{
     checkedAt:new Date(clock()).toISOString(),headlines:[],providerStatus:{},
     notice:'News feeds unavailable; do not invent headlines.'};
    let assessment;
    const symbol=String(req.query?.symbol||'EURUSD').toUpperCase();
    if(/^(?:[A-Z]{6}|[A-Z0-9]{3,20}USDT)$/.test(symbol))
      assessment=calendar.assess(events,symbol);
    return res.status(200).json({...events,news:headlines,assessment:assessment||null});
   }
   if(mode==='backtest'){
    const user=await core.identity(req),account=await core.member(user);
    const permitted=account.isAdmin===true||['active','granted','administrator'].includes(account.status);
    // A 72h trial's 3 signal unlocks do not authorize unlimited premium simulations.
    if(!permitted)return res.status(403).json({
     error:'Historical strategy validation requires an active paid or administrator entitlement.'});
    const symbol=String(req.query?.symbol||'BTCUSDT').toUpperCase();
    const days=Math.max(30,Math.min(240,Math.floor(Number(req.query?.days)||90)));
    if(!/^(?:[A-Z]{6}|[A-Z0-9]{3,20}USDT)$/.test(symbol))
     return res.status(400).json({error:'Unsupported market symbol'});
    const data=await backtest.run(symbol,days);
    return res.status(200).json(data);
   }
   return res.status(404).json({error:'Unknown research mode. Premium signal automation not enabled.'});
  }catch(e){
   const code=e?.status===401||e?.status===403?e.status:503;
   return res.status(code).json({error:code===503?'Verified research data temporarily unavailable.':String(e.message||'Authorization required')});
  }
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
