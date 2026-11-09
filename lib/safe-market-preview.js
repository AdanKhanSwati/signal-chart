'use strict';
/* Legacy market scanner compatibility endpoint.
 * This is a non-actionable, free-market preview ONLY. Premium entry, direction,
 * stop-loss, targets and explanation must never leave the secured POST unlock API.
 */
function createHandler(core,trial,market){
 return async function(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
   if(req.method!=='GET')return res.status(405).json({error:'Only read-only previews are allowed'});
   const rows=await trial.listSignals(market);
   const items=(Array.isArray(rows)?rows:[]).map(s=>({
    id:s.signalKey,signalKey:s.signalKey,market:s.market,asset:s.asset,
    pair:s.asset,symbol:s.asset,status:'PREVIEW',
    reason:'Details require an active verified membership or an explicit trial unlock.',
    publishedAt:s.publishedAt
   }));
   return res.status(200).json({items,generatedAt:new Date().toISOString(),
    premiumUnlockEndpoint:'/api/premium-signals?action=unlock',
    note:'Free previews omit actionable premium trade details.'});
  }catch(e){return core.handleError(res,e)}
 };
}
function handlerFactory(market){
 return async function(req,res){
  const core=require('../lib/candriva-core');
  const trial=require('../lib/trial-gate').createTrialGateway(core);
  return createHandler(core,trial,market)(req,res);
 }
}
module.exports={createHandler,handlerFactory};
