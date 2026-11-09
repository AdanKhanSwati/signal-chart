'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {submitPayment,reviewPayment,MAX_RECEIPT_BYTES}=require('../lib/manual-payments');
const payment=(id='a'.repeat(64))=>submitPayment({memberId:'member1',transactionId:id,receiptMime:'image/png',receiptSize:1000,quotedAmountBTC:0.0002,recipientWallet:'bc1testaddress',note:''},{now:1000});
test('customer submission stays pending without subscription approval',()=>{
 const p=payment();assert.equal(p.status,'pending');assert.equal(p.decision,null);assert.equal(p.txid,'a'.repeat(64));
});
test('approval requires explicit manual on-chain verification',()=>{
 assert.throws(()=>reviewPayment(payment(),{decision:'approved',adminUserId:'admin1',now:5000}),/independently verify/);
});
test('payment may only be approved once',()=>{
 const p=reviewPayment(payment(),{decision:'approved',adminUserId:'admin1',verifiedOnChain:true,now:5000});
 assert.equal(p.status,'approved');assert.equal(p.paymentId,p.id);
 assert.throws(()=>reviewPayment(p,{decision:'approved',adminUserId:'admin1',verifiedOnChain:true,now:6000}));
});
test('rejection requires a reason and is never an approval',()=>{
 assert.throws(()=>reviewPayment(payment(),{decision:'rejected',adminUserId:'admin1',now:5000}),/Rejection reason/);
 const p=reviewPayment(payment(),{decision:'rejected',adminUserId:'admin1',note:'Cannot confirm transfer',now:5000});
 assert.equal(p.status,'rejected');assert.equal(p.verifiedOnChain,false);
});
test('receipt MIME type and size are validated',()=>{
 assert.throws(()=>submitPayment({memberId:'1',transactionId:'a'.repeat(64),receiptMime:'image/svg+xml',receiptSize:100,quotedAmountBTC:.001,recipientWallet:'wallet',note:''}),/PNG or JPEG/);
 assert.throws(()=>submitPayment({memberId:'1',transactionId:'a'.repeat(64),receiptMime:'image/png',receiptSize:MAX_RECEIPT_BYTES+1,quotedAmountBTC:.001,recipientWallet:'wallet',note:''}),/1.4 MB/);
});
test('invalid BTC transaction hashes are rejected',()=>{
 assert.throws(()=>payment('abcdef'),/64-character/);
});
