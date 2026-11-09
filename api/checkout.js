'use strict';
/** Manual BTC checkout verification API. No funds move through SignalChart. */
const err=(status,message)=>Object.assign(new Error(message),{status});
function createHandler(core,service){
 return async function(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const action=String(req.query?.action||'');
   // Exchange-rate reference only; public route never creates a payable invoice.
   if(req.method==='GET'&&action==='quote')return res.status(200).json(await service.quote());
   const user=await core.identity(req),account=await core.member(user);
   core.adminOnly(account);
   if(req.method==='GET'&&action==='verify'){
    const p=await service.paymentById(req.query?.paymentId);
    if(await service.reviewOf(p))throw err(409,'Payment already reviewed');
    return res.status(200).json(await service.verifyChain(p));
   }
   if(req.method==='POST'&&action==='approve'){
    const body=core.securePost(req);
    // Never trust a browser's verification flag: service.review runs blockchain
    // verification again immediately before writing an immutable decision.
    const review=await service.review(account,{paymentId:body.paymentId,
      decision:'approved',confirmedOnChain:true,note:body.note||''});
    const pay=await service.paymentById(body.paymentId);
    const accountAfter=await core.member({uid:pay.uid||pay.memberId,email:pay.email||user.email,name:''});
    return res.status(200).json({review,paidUntil:accountAfter.paidUntil,status:accountAfter.status});
   }
   if(req.method==='POST'&&action==='sync_approved'){
    const body=core.securePost(req);
    const result=await service.syncApprovedPayment(body.paymentId,account);
    return res.status(200).json({synced:true,result});
   }
   throw err(404,'Unknown checkout action');
  }catch(e){return core.handleError(res,e)}
 };
}
function handler(req,res){
 const core=require('../lib/candriva-core');
 return createHandler(core,require('../lib/billing-service').createService(core))(req,res);
}
module.exports=handler;module.exports.createHandler=createHandler;
