'use strict';
/* Premium signals are never delivered in public feeds or in GET responses.
 * The user must explicitly POST one signalKey to unlock; the DB transaction
 * enforces a 72-hour term and THREE unique crypto/forex signals total. */
function issue(status,message){return Object.assign(new Error(message),{status})}
function createHandler(core,gate){
 return async function(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const action=String(req.query?.action||'');
   if(req.method==='GET'&&action==='list'){
    const market=req.query?.market||null;
    if(market!==null&&market!=='crypto'&&market!=='forex')throw issue(400,'Invalid market');
    return res.status(200).json({signals:await gate.listSignals(market)});
   }
   if(req.method==='POST'&&action==='unlock'){
    const request=core.securePost(req,5000);
    const user=await core.identity(req),account=await core.member(user);
    // Recalculate paid/grant on every request. Client claims are irrelevant.
    const paid=account.isAdmin===true||account.status==='active'||account.status==='granted';
    const result=await gate.premiumUnlock(user.uid,request.signalKey,paid);
    if(!result.allowed){
     return res.status(result.reason==='not_found'?404:403).json({
      error:result.reason==='trial_exhausted'?'All 3 trial signals have been used. Upgrade to continue.':
       result.reason==='phone_verification_required'?'Verify your phone to activate your trial.':
       result.reason==='trial_expired'?'Trial expired. Upgrade to continue.':'Premium access requires an active membership.',
      reason:result.reason,signalsUsed:result.signalsUsed,signalsRemaining:result.signalsRemaining});
    }
    res.setHeader('Cache-Control','no-store, no-cache, private, max-age=0, must-revalidate');
    return res.status(200).json(result);
   }
   throw issue(405,'Unlock premium signals using an authenticated POST request');
  }catch(e){return core.handleError(res,e)}
 };
}
function handler(req,res){
 const core=require('../lib/candriva-core');
 return createHandler(core,require('../lib/trial-gate').createTrialGateway(core))(req,res);
}
module.exports=handler;module.exports.createHandler=createHandler;
