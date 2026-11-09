'use strict';
/** Resolve only approved decisions referencing this verified member's payments.
 * Payment requests, screenshots and rejected decisions never grant access. */
function approvedForMember(uid,payments,reviews){
 const ids=new Set((Array.isArray(payments)?payments:[])
  .filter(p=>p&&(p.uid===uid||p.memberId===uid)&&typeof p.id==='string')
  .map(p=>p.id));
 const seen=new Set();
 const results=[];
 for(const d of Array.isArray(reviews)?reviews:[]){
  const id=d?.paymentId||d?.id,at=d?.at||d?.reviewedAt;
  if(!id||!ids.has(id)||seen.has(id)||d.decision!=='approved'||!Number.isFinite(Date.parse(at)))continue;
  seen.add(id);results.push({paymentId:id,decision:'approved',at,verifiedOnChain:d.verifiedOnChain===true});
 }
 return results;
}
module.exports={approvedForMember};
