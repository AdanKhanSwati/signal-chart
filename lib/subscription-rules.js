'use strict';
const HOUR=3600000, DAY=24*HOUR;
const {resolveManualGrants}=require('./manual-access');
function entitlement(trial,approvals,time,isAdmin=false,manualGrants=[],memberUserId=null){
 const at=Number(time),start=Date.parse(trial.trialStartedAt),end=Date.parse(trial.trialEndsAt);
 if(!Number.isFinite(at)||!Number.isFinite(start)||!Number.isFinite(end)||![24,72].includes(Math.round((end-start)/HOUR)))throw Error('Corrupted trial record');
 // The agreed offer is 72 hours from first signup. Preserve any longer existing promise.
 const effectiveEnd=Math.max(end,start+72*HOUR);
 const ordered=[...(approvals||[])].filter(x=>x?.decision==='approved'&&Number.isFinite(Date.parse(x.at))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||String(a.paymentId).localeCompare(String(b.paymentId)));
 let paidUntil=0;const seen=new Set();
 for(const payment of ordered){if(!payment.paymentId||seen.has(payment.paymentId))continue;seen.add(payment.paymentId);paidUntil=Math.max(paidUntil,Date.parse(payment.at))+30*DAY}
 const manual=resolveManualGrants(manualGrants,at,memberUserId);
 const activePaid=paidUntil>at,activeTrial=at<effectiveEnd;
 const endOfAccess=Math.max(activePaid?paidUntil:0,activeTrial?effectiveEnd:0,manual.active?Date.parse(manual.endsAt):0);
 const status=isAdmin?'administrator':activePaid?'active':manual.active?'granted':activeTrial?'trial':'locked';
 return {status,access:isAdmin||status!=='locked',trialStartedAt:trial.trialStartedAt,trialEndsAt:new Date(effectiveEnd).toISOString(),
 paidUntil:paidUntil?new Date(paidUntil).toISOString():null,manualEndsAt:manual.endsAt,
 accessUntil:isAdmin?null:endOfAccess?new Date(endOfAccess).toISOString():null,
 remainingSeconds:isAdmin?0:Math.max(0,Math.floor((endOfAccess-at)/1000))};
}
module.exports={entitlement,HOUR,DAY};
