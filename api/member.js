'use strict';
/** Compatibility API for SignalChart account.html / admin.html.
 * Uses the same payment service and entitlement store as /api/cv-ops. */
const err=(status,message)=>Object.assign(new Error(message),{status});
function createHandler(core,service){
 const {identity,member,adminOnly,handleError,securePost,records}=core;
 return async function(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const person=await identity(req),account=await member(person);
   const action=String(req.query?.action||'');
   if(req.method==='GET'&&action==='me'){
    const [config,requests]=await Promise.all([service.billing(),service.paymentsFor(person.uid)]);
    return res.status(200).json({account,payment:{
      enabled:config.enabled,priceUSD:config.priceUSD,network:config.network,
      wallet:config.wallet,amountBTC:config.btcMonthly},requests});
   }
   if(req.method==='GET'&&action==='receipt'){
    adminOnly(account);const file=await service.receipt(req.query?.id);
    res.setHeader('Content-Type',file.mime);
    return res.status(200).end(file.bytes);
   }
   if(req.method==='GET'&&['admin_dashboard','admin_users','admin_payments','admin_settings'].includes(action)){
    adminOnly(account);
    if(action==='admin_settings'){
     const cfg=await service.billing();
     return res.status(200).json({settings:{
       priceUSD:cfg.priceUSD,network:cfg.network,wallet:cfg.wallet,btcMonthly:cfg.btcMonthly,enabled:cfg.enabled}});
    }
    if(action==='admin_payments'){
     const all=await service.allPayments(),payments=await Promise.all(all.map(p=>service.displayPayment(p)));
     return res.status(200).json({payments:payments.map(p=>({
       ...p,amountUSD:20,recipient:p.recipientWallet,
       decision:p.decision==='pending'?null:{decision:p.decision}}))});
    }
    const list=await records('cv2/members/',2000),byId=new Map();
    for(const r of list)if(r&&r.uid&&r.trialStartedAt&&r.trialEndsAt&&!byId.has(r.uid))
      byId.set(r.uid,r);
    const users=[];
    for(const r of byId.values()){
     const m=await member({uid:r.uid,email:r.email||'',name:r.name||''});
     users.push({uid:r.uid,email:r.email||'',status:m.status,
       trialEndsAt:m.trialEndsAt,paidUntil:m.paidUntil,accessUntil:m.accessUntil});
    }
    if(action==='admin_users')return res.status(200).json({users});
    const payments=await service.allPayments(),reviewed=await Promise.all(payments.map(p=>service.displayPayment(p)));
    const count=x=>users.filter(u=>u.status===x).length;
    return res.status(200).json({counts:{
      users:users.length,trial:count('trial'),locked:count('locked'),
      active:count('active')+count('granted'),
      paymentsPending:reviewed.filter(p=>p.decision==='pending').length},
      paymentsEnabled:(await service.billing()).enabled});
   }
   if(req.method==='POST'&&action==='admin_review'){
    adminOnly(account);const body=securePost(req);
    if(!['approved','rejected'].includes(body.decision))throw err(400,'Choose approve or reject');
    const decision=await service.review(account,{paymentId:body.paymentId,
      decision:body.decision,confirmedOnChain:body.confirmedOnChain===true,note:body.note||''});
    return res.status(200).json({decision});
   }
   if(req.method==='POST'&&action==='admin_save_settings')
    throw err(400,'Bitcoin billing settings are managed in Super Admin Operations');
   if(req.method==='POST'&&action==='pay')
    throw err(400,'Use Membership & Billing to submit BTC transaction evidence');
   throw err(404,'Unknown member action');
  }catch(e){return handleError(res,e)}
 };
}
function handler(req,res){
 const core=require('../lib/candriva-core');
 return createHandler(core,require('../lib/billing-service').createService(core))(req,res);
}
module.exports=handler;module.exports.createHandler=createHandler;
