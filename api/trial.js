'use strict';
/* Backend-only trial administration and SMS phone-change verification. */
function issue(status,message){return Object.assign(new Error(message),{status})}
function createHandler(core,gate){
 return async function(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const user=await core.identity(req),action=String(req.query?.action||'');
   if(req.method==='GET'&&action==='state'){
    return res.status(200).json(await gate.state(user.uid));
   }
   if(req.method==='POST'&&action==='otp_start'){
    const body=core.securePost(req,5000);
    return res.status(200).json(await gate.otpStart(req,body.phone));
   }
   if(req.method==='POST'&&action==='otp_verify'){
    const body=core.securePost(req,5000);
    return res.status(200).json(await gate.otpVerify(req,body.phone,body.code));
   }
   if(req.method==='POST'&&action==='activate_existing_phone'){
    core.securePost(req,5000);
    return res.status(200).json(await gate.activateExistingVerifiedPhone(req));
   }
   if(req.method==='POST'&&action==='upgrade_click'){
    core.securePost(req,5000);
    await gate.rpc('sc_log_trial_event',{p_user:user.uid,p_event_type:'upgrade_clicked',p_signal_key:null});
    return res.status(200).json({recorded:true});
   }
   if(action.startsWith('admin_')){
    const actor=await core.member(user);core.adminOnly(actor);
    if(req.method==='GET'&&action==='admin_metrics')
      return res.status(200).json({metrics:await gate.rpc('sc_admin_trial_analytics',{})});
    if(req.method==='GET'&&action==='admin_trials')
      return res.status(200).json({members:await gate.rpc('sc_admin_trial_list',{
       p_query:String(req.query?.q||'').slice(0,100),p_limit:100})});
    if(req.method==='POST'&&['admin_exception','admin_revoke','admin_resolve_risk'].includes(action)){
     const body=core.securePost(req,5000);
     const map={admin_exception:'exception',admin_revoke:'revoke',admin_resolve_risk:'risk_resolved'};
     const result=await gate.admin(map[action],actor,{
      userId:body.userId,phoneHash:action==='admin_exception'?gate.hashPhone(body.phone):null,
      reason:body.reason,validUntil:body.validUntil});
     return res.status(200).json(result);
    }
   }
   throw issue(404,'Unknown trial action');
  }catch(e){return core.handleError(res,e)}
 };
}
function handler(req,res){
 const core=require('../lib/candriva-core');
 return createHandler(core,require('../lib/trial-gate').createTrialGateway(core))(req,res);
}
module.exports=handler;module.exports.createHandler=createHandler;
