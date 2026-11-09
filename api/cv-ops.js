'use strict';
/** Current web customer/ops API. All mutations require a verified Supabase JWT. */
const err=(status,message)=>Object.assign(new Error(message),{status});
function createHandler(core,service){
 const {identity,member,adminOnly,handleError,securePost}=core;
 const asJson=(res,data,code=200)=>res.status(code).json(data);
 return async function(req,res){
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const identityRecord=await identity(req),account=await member(identityRecord);
   const action=String(req.query?.action||'');
   if(req.method==='GET'&&action==='me'){
    const [checkout,payments]=await Promise.all([service.billing(),service.paymentsFor(identityRecord.uid)]);
    return asJson(res,{account,checkout,payments,tickets:[]});
   }
   if(req.method==='GET'&&action==='admin'){
    adminOnly(account);
    const [items,settings]=await Promise.all([service.allPayments(),service.billing()]);
    const payments=await Promise.all(items.slice(0,1000).map(p=>service.displayPayment(p)));
    return asJson(res,{payments,billing:settings,tickets:[],
     stats:{pendingPayments:payments.filter(p=>p.decision==='pending').length,
       totalPayments:payments.length,openTickets:0}});
   }
   if(req.method==='GET'&&action==='receipt'){
    adminOnly(account);
    const file=await service.receipt(req.query?.id);
    res.setHeader('Content-Type',file.mime);
    res.setHeader('Content-Disposition','inline; filename="payment-evidence"');
    res.setHeader('X-Content-Type-Options','nosniff');
    return res.status(200).end(file.bytes);
   }
   if(req.method==='POST'&&action==='submit_payment'){
    const body=securePost(req);
    const result=await service.submit(identityRecord,body);
    return asJson(res,result,201);
   }
   if(req.method==='POST'&&action==='review_payment'){
    adminOnly(account);
    const body=securePost(req);
    if(body.decision!=='rejected')throw err(400,'Use verified checkout approval for approved payments');
    const result=await service.review(account,{
      paymentId:body.paymentId,decision:'rejected',note:body.note});
    return asJson(res,{review:result});
   }
   if(req.method==='POST'&&action==='save_billing'){
    adminOnly(account);
    const body=securePost(req);
    return asJson(res,{settings:await service.saveBilling(account,body)});
   }
   if(['new_ticket','messages','reply','close_ticket'].includes(action))
    throw err(503,'Support messaging backend is still being restored');
   throw err(404,'Unknown action');
  }catch(e){return handleError(res,e)}
 };
}
function handler(req,res){
 const core=require('../lib/candriva-core');
 return createHandler(core,require('../lib/billing-service').createService(core))(req,res);
}
module.exports=handler;module.exports.createHandler=createHandler;
