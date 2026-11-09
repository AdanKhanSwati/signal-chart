'use strict';
/** Controlled premium-signal proposal and approval API.
 * This does NOT generate or auto-publish trade signals. Neither request nor
 * response exposes service-role credentials to the client.
 */
const issue=(status,message)=>Object.assign(new Error(message),{status});
function createHandler(core,gate){
 return async function(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const action=String(req.query?.action||'');
   if(req.method!=='POST'&&!(req.method==='GET'&&action==='queue'))
    throw issue(405,'Unsupported method');
   const user=await core.identity(req);
   const account=await core.member(user);
   core.adminOnly(account);
   if(req.method==='GET'&&action==='queue'){
    return res.status(200).json({proposals:await gate.rpc('sc_signal_proposal_queue',{p_limit:50})});
   }
   const body=core.securePost(req,12000);
   if(action==='submit'){
    if(!body||typeof body!=='object'||Array.isArray(body)||
      typeof body.signalKey!=='string'||typeof body.market!=='string'||
      typeof body.asset!=='string'||typeof body.source!=='string'||
      typeof body.candleClosedAt!=='string'||
      !body.analysis||typeof body.analysis!=='object'||Array.isArray(body.analysis))
      throw issue(400,'Incomplete signal proposal');
    const result=await gate.rpc('sc_propose_premium_signal',{
     p_actor:user.uid,p_signal_key:body.signalKey,p_market:body.market,
     p_asset:body.asset,p_candle_closed_at:body.candleClosedAt,
     p_source:body.source,p_analysis:body.analysis
    });
    return res.status(201).json(result);
   }
   if(action==='review'){
    if(!body||typeof body!=='object'||Array.isArray(body)||
      !/^[0-9a-f-]{36}$/i.test(String(body.proposalId||''))||
      !['approve','reject'].includes(body.decision)||
      typeof body.reason!=='string'||body.reason.trim().length<8)
      throw issue(400,'Invalid signal review');
    const result=await gate.rpc('sc_review_premium_signal',{
     p_actor:user.uid,p_proposal:body.proposalId,
     p_decision:body.decision,p_reason:body.reason
    });
    return res.status(200).json(result);
   }
   throw issue(404,'Unknown publishing operation');
  }catch(e){return core.handleError(res,e)}
 };
}
module.exports=function(req,res){
 const core=require('../lib/candriva-core');
 const gate=require('../lib/trial-gate').createTrialGateway(core);
 return createHandler(core,gate)(req,res);
};
module.exports.createHandler=createHandler;
