'use strict';
/**
 * RECONSTRUCTED SUBSCRIPTION REGRESSION TEST.
 * Original pre-deployment tests/subscription.test.js is NOT SHA1-recovered.
 * This is independent behavior validation, not proof of byte-for-byte recovery.
 */
const test=require('node:test'),assert=require('node:assert/strict');
const {trialTermAllowsExistingSignals}=require('../lib/candriva-core');
const {entitlement,HOUR,DAY}=require('../lib/subscription-rules');
const {approvedForMember}=require('../lib/entitlement-store');
const now=Date.parse('2026-11-10T10:00:00Z'),uid='11111111-1111-4111-8111-111111111111';
const term=(status,mins=30,used=0,remaining=3-used)=>({
 trialStatus:status,signalsUsed:used,signalsRemaining:remaining,
 expiresAt:new Date(now+mins*60000).toISOString()
});
const placeholder={trialStartedAt:'2000-01-01T00:00:00.000Z',trialEndsAt:'2000-01-02T00:00:00.000Z'};
test('72h active trial allows users to view their remaining premium slots',()=>{
 assert.equal(trialTermAllowsExistingSignals(term('active'),now),true);
 assert.equal(trialTermAllowsExistingSignals(term('active',30,2,1),now),true);
});
test('three consumed signal slots do not prematurely lock the 72-hour membership',()=>{
 assert.equal(trialTermAllowsExistingSignals(term('exhausted',30,3,0),now),true);
 assert.equal(trialTermAllowsExistingSignals(term('exhausted',30,3,0),now+29*60000),true);
});
test('exhausted trial immediately locks at its exact expiry',()=>{
 assert.equal(trialTermAllowsExistingSignals(term('exhausted',30,3,0),now+30*60000),false);
});
test('revoked, expired, missing, malformed or fabricated trial states never grant access',()=>{
 assert.equal(trialTermAllowsExistingSignals(term('revoked',30,3,0),now),false);
 assert.equal(trialTermAllowsExistingSignals(term('expired',30,3,0),now),false);
 assert.equal(trialTermAllowsExistingSignals(term('not_activated',30,0,0),now),false);
 assert.equal(trialTermAllowsExistingSignals({...term('exhausted'),signalsUsed:2},now),false);
 assert.equal(trialTermAllowsExistingSignals({...term('active'),signalsRemaining:0},now),false);
 assert.equal(trialTermAllowsExistingSignals({trialStatus:'exhausted',signalsUsed:3,expiresAt:'invalid'},now),false);
 assert.equal(trialTermAllowsExistingSignals(null,now),false);
});
test('expired historical Blob trial is not an entitlement without a verified Supabase claim',()=>{
 const old=entitlement(placeholder,[],now);
 assert.equal(old.access,false);
 assert.equal(old.status,'locked');
});
test('approved payment grants 30 days; pending and rejected requests do not',()=>{
 const at=new Date(now-1000).toISOString();
 const paid=entitlement(placeholder,[{paymentId:'p',decision:'approved',at}],now);
 const pending=entitlement(placeholder,[{paymentId:'p',decision:'pending',at}],now);
 const rejected=entitlement(placeholder,[{paymentId:'p',decision:'rejected',at}],now);
 assert.equal(paid.status,'active');
 assert.equal(Date.parse(paid.paidUntil),Date.parse(at)+30*DAY);
 assert.equal(pending.status,'locked');
 assert.equal(rejected.status,'locked');
});
test('repeat identical payment approvals cannot extend paid access',()=>{
 const a={paymentId:'same',decision:'approved',at:new Date(now).toISOString()};
 const result=entitlement(placeholder,[a,a],now+HOUR);
 assert.equal(result.paidUntil,new Date(now+30*DAY).toISOString());
});
test('payments from another user never appear in current member approvals',()=>{
 const p=[{id:'correct',uid},{id:'wrong',uid:'99999999-9999-4999-8999-999999999999'}];
 const d=[{paymentId:'correct',decision:'approved',at:new Date(now).toISOString(),verifiedOnChain:true},
 {paymentId:'wrong',decision:'approved',at:new Date(now).toISOString(),verifiedOnChain:true}];
 assert.deepEqual(approvedForMember(uid,p,d).map(x=>x.paymentId),['correct']);
});
test('approval records for unknown invoices and repeated decisions are ignored',()=>{
 const approved=approvedForMember(uid,[{id:'one',uid}],[{
  paymentId:'unknown',decision:'approved',at:new Date(now).toISOString()
 },{
  paymentId:'one',decision:'approved',at:new Date(now).toISOString(),verifiedOnChain:true
 },{
  paymentId:'one',decision:'approved',at:new Date(now+1000).toISOString(),verifiedOnChain:true
 }]);
 assert.equal(approved.length,1);
 assert.equal(approved[0].paymentId,'one');
});
test('administrator permission is separate from customer trial conditions',()=>{
 const admin=entitlement(placeholder,[],now,true);
 assert.equal(admin.status,'administrator');
 assert.equal(admin.access,true);
});
