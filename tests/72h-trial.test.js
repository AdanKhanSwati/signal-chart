'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {entitlement,HOUR}=require('../lib/subscription-rules');
const start=Date.parse('2026-11-09T00:00:00Z');
const record=h=>({trialStartedAt:new Date(start).toISOString(),trialEndsAt:new Date(start+h*HOUR).toISOString()});
test('existing 24-hour trial records get 72-hour access',()=>{
 const r=entitlement(record(24),[],start+48*HOUR);
 assert.equal(r.status,'trial');assert.equal(r.trialEndsAt,new Date(start+72*HOUR).toISOString());
});
test('trial ends at 72 hours',()=>{
 assert.equal(entitlement(record(72),[],start+71*HOUR).status,'trial');
 assert.equal(entitlement(record(72),[],start+72*HOUR).status,'locked');
});
test('duplicate payment approvals count only once',()=>{
 const a={decision:'approved',paymentId:'one',at:new Date(start+72*HOUR).toISOString()};
 const r=entitlement(record(72),[a,a],start+73*HOUR);
 assert.equal(r.status,'active');assert.equal(r.paidUntil,new Date(start+(72+30*24)*HOUR).toISOString());
});
test('administrator access is independent of trial expiry',()=>{
 assert.equal(entitlement(record(72),[],start+1000*HOUR,true).status,'administrator');
});
test('invalid trial records are rejected',()=>{
 assert.throws(()=>entitlement({...record(72),trialEndsAt:'not-a-date'},[],start+HOUR));
});
