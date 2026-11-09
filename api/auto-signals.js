'use strict';
/** Protected hourly SignalChart signal scanner endpoint.
 * Trigger using Supabase Cron with a dedicated secret; not Vercel Hobby Cron.
 * A separate database kill switch prevents accidental publication.
 */
const {createHmac,timingSafeEqual}=require('node:crypto');
const {createAutoEngine}=require('../lib/sc-auto-engine');
function authorized(req,secret,clock=Date.now()){
 const timestamp=String(req.headers?.['x-sc-timestamp']||'');
 const signature=String(req.headers?.['x-sc-signature']||'');
 if(!secret||String(secret).length<32||
  !/^\d{10}$/.test(timestamp)||!/^[0-9a-f]{64}$/.test(signature))return false;
 if(Math.abs(clock-Number(timestamp)*1000)>180000)return false;
 const expected=createHmac('sha256',String(secret)).update(timestamp+'.{}').digest('hex');
 return timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(expected,'hex'));
}
function createHandler({engineFactory=createAutoEngine,makeGateway=null,
 env=process.env,now=()=>Date.now()}={}){
 return async function(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  if(!authorized(req,env.SC_AUTO_CRON_SECRET,now()))
   return res.status(401).json({error:'Unauthorized'});
  if(env.SC_AUTO_PUBLISH_ENABLED!=='true')
   return res.status(503).json({error:'Automatic publication is not activated'});
  try{
   const gate=makeGateway?makeGateway():require('../lib/trial-gate').createTrialGateway(require('../lib/candriva-core'));
   const publisher=async item=>{
    return gate.rpc('sc_publish_automatic_signal',{
     p_signal_key:item.signalKey,p_market:item.market,p_asset:item.asset||item.symbol,
     p_source:item.source,p_closed_at:item.candleClosedAt,p_analysis:item.analysis});
   };
   const engine=engineFactory({publisher,allowIndicativeForex:false,now});
   const result=await engine.run({publish:true});
   await gate.rpc('sc_record_auto_scan',{
    p_status:result.status,p_scanned:result.scanned,
    p_qualified:result.qualified||0,p_published:result.published||0,
    p_errors:result.errors||0,p_metadata:{
     strategy:'sc-hourly-ema-breakout-v1',counts:result.counts||{},
     source:'verified closed candles and economic calendar'
    }
   });
   return res.status(result.status==='COMPLETED'?200:503).json({
    status:result.status,scanned:result.scanned,
    qualified:result.qualified||0,published:result.published||0,
    checkedAt:new Date(now()).toISOString(),counts:result.counts||{}});
  }catch{
   // No sensitive API keys, market payloads or exception internals in responses.
   return res.status(503).json({status:'ERROR',
    error:'Automatic signal scan or audit temporarily unavailable'});
  }
 };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
module.exports.authorized=authorized;
