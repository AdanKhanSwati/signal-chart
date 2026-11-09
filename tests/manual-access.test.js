'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createGrantEvent,createRevokeEvent,resolveManualGrants}=require('../lib/manual-access');
const {entitlement,HOUR,DAY}=require('../lib/subscription-rules');
const MEMBER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',ADMIN='33333333-3333-4333-8333-333333333333';
const T=Date.parse('2026-11-09T00:00:00Z');
const trial={trialStartedAt:new Date(T).toISOString(),trialEndsAt:new Date(T+72*HOUR).toISOString()};
const grant=(end,memberId=MEMBER)=>createGrantEvent({memberId,expiresAt:new Date(T+end).toISOString(),reason:'Founder promotional access'},{adminUserId:ADMIN,now:T});
test('manual 17-day access extends expired 72-hour trial without payment',()=>{
 const g=grant(17*DAY),a=entitlement(trial,[],T+7*DAY,false,[g],MEMBER);
 assert.equal(a.status,'granted');assert.equal(a.access,true);assert.equal(a.manualEndsAt,g.expiresAt);assert.equal(a.accessUntil,g.expiresAt);
});
test('grant expiry locks when trial and paid access have ended',()=>{
 const g=grant(17*DAY);const a=entitlement(trial,[],T+17*DAY,false,[g],MEMBER);
 assert.equal(a.status,'locked');assert.equal(a.access,false);
});
test('grant is never applied without matching member UID',()=>{
 const g=grant(30*DAY);
 assert.equal(entitlement(trial,[],T+8*DAY,false,[g],OTHER).access,false);
 assert.equal(entitlement(trial,[],T+8*DAY,false,[g]).access,false);
});
test('admin revokes individual grants; overlapping grants remain independent',()=>{
 const g1=grant(30*DAY),g2=grant(40*DAY);
 const rv=createRevokeEvent({memberId:MEMBER,grantId:g1.id,reason:'Requested withdrawal'},{adminUserId:ADMIN,now:T+2*DAY});
 assert.equal(resolveManualGrants([g1,g2,rv],T+10*DAY,MEMBER).endsAt,g2.expiresAt);
 const rv2=createRevokeEvent({memberId:MEMBER,grantId:g2.id,reason:'Requested withdrawal'},{adminUserId:ADMIN,now:T+3*DAY});
 assert.equal(entitlement(trial,[],T+10*DAY,false,[g1,g2,rv,rv2],MEMBER).status,'locked');
});
test('manual revocation does not terminate paid access',()=>{
 const g=grant(30*DAY),r=createRevokeEvent({memberId:MEMBER,grantId:g.id,reason:'Demo ended'},{adminUserId:ADMIN,now:T+DAY});
 const p={paymentId:'p1',decision:'approved',at:new Date(T+4*DAY).toISOString()};
 assert.equal(entitlement(trial,[p],T+10*DAY,false,[g,r],MEMBER).status,'active');
});
test('scheduled grant cannot unlock early',()=>{
 const g=createGrantEvent({memberId:MEMBER,startsAt:new Date(T+7*DAY).toISOString(),expiresAt:new Date(T+14*DAY).toISOString(),reason:'Future access'},{adminUserId:ADMIN,now:T});
 assert.equal(entitlement(trial,[],T+5*DAY,false,[g],MEMBER).access,false);
 assert.equal(entitlement(trial,[],T+8*DAY,false,[g],MEMBER).status,'granted');
});
test('invalid expiry is rejected',()=>{
 assert.throws(()=>createGrantEvent({memberId:MEMBER,expiresAt:new Date(T).toISOString(),reason:'Invalid'},{adminUserId:ADMIN,now:T}));
});
test('unrelated member revocation has no effect',()=>{
 const g=grant(20*DAY),r=createRevokeEvent({memberId:OTHER,grantId:g.id,reason:'Unrelated'},{adminUserId:ADMIN,now:T+DAY});
 assert.equal(entitlement(trial,[],T+8*DAY,false,[g,r],MEMBER).status,'granted');
});
