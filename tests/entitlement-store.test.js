'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {approvedForMember}=require('../lib/entitlement-store');
const {entitlement,HOUR,DAY}=require('../lib/subscription-rules');
const UID='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const t=Date.parse('2026-11-09T00:00:00Z');
const trial={trialStartedAt:new Date(t).toISOString(),trialEndsAt:new Date(t+24*HOUR).toISOString()};
const payments=[{id:'a',uid:UID},{id:'b',uid:OTHER},{id:'c',memberId:UID}];
const at=new Date(t+25*HOUR).toISOString();
test('unapproved evidence never unlocks premium access',()=>{
 const decisions=approvedForMember(UID,payments,[]);
 assert.equal(entitlement(trial,decisions,t+25*HOUR).access,false);
});
test('review stored for another customer cannot unlock my account',()=>{
 const decisions=approvedForMember(UID,payments,[{paymentId:'b',decision:'approved',at}]);
 assert.equal(decisions.length,0);
 assert.equal(entitlement(trial,decisions,t+25*HOUR).status,'locked');
});
test('review stored for matching payment grants 30 days',()=>{
 const decisions=approvedForMember(UID,payments,[{paymentId:'a',decision:'approved',at,verifiedOnChain:true}]);
 assert.equal(entitlement(trial,decisions,t+26*HOUR).status,'active');
 assert.equal(entitlement(trial,decisions,t+26*HOUR).paidUntil,new Date(t+25*HOUR+30*DAY).toISOString());
});
test('rejection and multiple review copies cannot double-charge or extend access',()=>{
 const decisions=approvedForMember(UID,payments,[
 {paymentId:'a',decision:'approved',at},
 {paymentId:'a',decision:'approved',at},
 {paymentId:'c',decision:'rejected',at}]);
 assert.equal(decisions.length,1);
 assert.equal(entitlement(trial,decisions,t+26*HOUR).paidUntil,new Date(t+25*HOUR+30*DAY).toISOString());
});
test('two separate approved payments extend subscription independently',()=>{
 const date2=new Date(t+48*HOUR).toISOString();
 const decisions=approvedForMember(UID,payments,[{paymentId:'a',decision:'approved',at},{paymentId:'c',decision:'approved',at:date2}]);
 const state=entitlement(trial,decisions,t+50*HOUR);
 assert.equal(state.paidUntil,new Date(t+25*HOUR+60*DAY).toISOString());
});
