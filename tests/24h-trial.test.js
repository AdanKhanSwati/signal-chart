'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {entitlement,HOUR,DAY}=require('../lib/subscription-rules');
const start=Date.parse('2026-11-09T00:00:00Z');
const record=hours=>({trialStartedAt:new Date(start).toISOString(),trialEndsAt:new Date(start+hours*HOUR).toISOString()});
test('legacy 24-hour record stays active before deadline',()=>{
 const a=entitlement(record(24),[],start+23*HOUR+59*60000);
 assert.equal(a.status,'trial');assert.equal(a.access,true);
 assert.equal(a.trialEndsAt,new Date(start+24*HOUR).toISOString());
 assert.equal(a.accessUntil,new Date(start+24*HOUR).toISOString());
});
test('legacy 24-hour record locks at exactly 24 hours',()=>{
 const a=entitlement(record(24),[],start+24*HOUR);
 assert.equal(a.status,'locked');assert.equal(a.access,false);
});
test('legacy 72-hour record preserves its previously stored expiry',()=>{
 const a=entitlement(record(72),[],start+36*HOUR);
 assert.equal(a.status,'locked');assert.equal(a.access,false);
 assert.equal(a.trialEndsAt,new Date(start+72*HOUR).toISOString());
});
test('manual approval grants paid access beyond expired trial',()=>{
 const approval={decision:'approved',paymentId:'payment-one',at:new Date(start+25*HOUR).toISOString()};
 const a=entitlement(record(24),[approval],start+30*HOUR);
 assert.equal(a.status,'active');assert.equal(a.access,true);
 assert.equal(a.paidUntil,new Date(start+25*HOUR+30*DAY).toISOString());
});
test('duplicate approvals cannot extend a paid subscription twice',()=>{
 const a={decision:'approved',paymentId:'one',at:new Date(start+24*HOUR).toISOString()};
 const r=entitlement(record(24),[a,a],start+25*HOUR);
 assert.equal(r.status,'active');
 assert.equal(r.paidUntil,new Date(start+24*HOUR+30*DAY).toISOString());
});
test('admin is not subject to customer trial expiry',()=>{
 assert.equal(entitlement(record(24),[],start+100*DAY,true).status,'administrator');
});
test('corrupted trial record fails closed',()=>{
 assert.throws(()=>entitlement({...record(24),trialEndsAt:'invalid'},[],start+HOUR));
});
