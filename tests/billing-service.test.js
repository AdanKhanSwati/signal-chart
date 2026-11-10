'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createService,WALLET}=require('../lib/billing-service');
const {entitlement,HOUR}=require('../lib/subscription-rules');
const memberId='11111111-1111-4111-8111-111111111111';
const person={uid:memberId,email:'tester@example.test'};
const admin={uid:'33333333-3333-4333-8333-333333333333',email:'ops@example.test'};
const TX='a'.repeat(64),TX2='b'.repeat(64);
const png='data:image/png;base64,'+Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64');
function setup(chainMode='valid'){
 const saved=new Map(),now=Date.parse('2026-11-09T00:00:00Z');
 const core={
  read:async p=>saved.get(p)||null,
  readBinary:async p=>saved.get(p)||null,
  write:async(p,value)=>{
   if(saved.has(p))throw Object.assign(Error('BlobAlreadyExistsError'),{status:409});
   saved.set(p,value);return {pathname:p};
  },
  records:async prefix=>[...saved].filter(([p])=>p.startsWith(prefix)&&p.endsWith('.json')).map(([,v])=>v),
  isConflict:e=>/BlobAlreadyExistsError/.test(String(e?.message))
 };
 const fetchFn=async url=>{
  if(url.endsWith('/blocks/tip/height'))return {ok:true,text:async()=>String(905)};
  if(url.includes('/api/tx/'))return {ok:true,json:async()=>({
   status:{confirmed:chainMode!=='unconfirmed',block_height:900},
   vout:[{scriptpubkey_address:chainMode==='wrong-wallet'?'bc1wrong':WALLET,value:22000}]})};
  throw Error('Unexpected upstream request');
 };
 const service=createService(core,{fetchFn,now:()=>now});
 return {core,service,saved,now};
}
async function enabled(x){
 process.env.CANDRIVA_PAYMENTS_ENABLED='true';
 await x.service.saveBilling(admin,{btcMonthly:0.0002,enabled:true});
 assert.equal((await x.service.billing()).enabled,true);
}
test('payments remain closed until explicit enablement',async()=>{
 const x=setup();assert.equal((await x.service.billing()).enabled,false);
 await assert.rejects(()=>x.service.submit(person,{txid:TX,receipt:png}),/paused/);
});
test('submission stores private receipt and pending payment, not entitlement',async()=>{
 const x=setup();await enabled(x);
 const r=await x.service.submit(person,{txid:TX,receipt:png,note:'Wallet transfer'});
 assert.equal(r.decision,'pending');
 const items=await x.service.paymentsFor(person.uid);
 assert.equal(items.length,1);assert.equal(items[0].decision,'pending');
 const receipt=await x.service.receipt(r.id);assert.equal(receipt.mime,'image/png');
 assert.equal(receipt.bytes.readUInt32BE(1),0x504e470d);
 const start=new Date(x.now).toISOString();
 const trial={trialStartedAt:start,trialEndsAt:new Date(x.now+24*HOUR).toISOString()};
 assert.equal(entitlement(trial,[],x.now+25*HOUR).access,false);
});
test('a repeated bitcoin transaction ID cannot be used by another account',async()=>{
 const x=setup();await enabled(x);
 await x.service.submit(person,{txid:TX,receipt:png});
 await assert.rejects(()=>x.service.submit({...person,uid:'22222222-2222-4222-8222-222222222222'},{txid:TX,receipt:png}),/already been submitted/);
});
test('admin independently verifies chain before approving and cannot approve twice',async()=>{
 const x=setup();await enabled(x);
 const p=await x.service.submit(person,{txid:TX,receipt:png});
 await assert.rejects(()=>x.service.review(admin,{paymentId:p.id,decision:'approved'}),/confirmation/);
 const verified=await x.service.verifyChain(await x.service.paymentById(p.id));
 assert.equal(verified.verified,true);
 const r=await x.service.review(admin,{paymentId:p.id,decision:'approved',confirmedOnChain:true});
 assert.equal(r.decision,'approved');
 assert.equal((await x.service.paymentsFor(memberId))[0].decision,'approved');
 await assert.rejects(()=>x.service.review(admin,{paymentId:p.id,decision:'approved',confirmedOnChain:true}),/already been reviewed/);
});
test('unconfirmed or incorrect destination cannot be approved',async()=>{
 for(const mode of ['unconfirmed','wrong-wallet']){
  const x=setup(mode);await enabled(x);
  const p=await x.service.submit(person,{txid:TX,receipt:png});
  assert.equal((await x.service.verifyChain(await x.service.paymentById(p.id))).verified,false);
  await assert.rejects(()=>x.service.review(admin,{paymentId:p.id,decision:'approved',confirmedOnChain:true}),/not verified/);
 }
});
test('rejection requires a reason and does not create an approval',async()=>{
 const x=setup();await enabled(x);const p=await x.service.submit(person,{txid:TX,receipt:png});
 await assert.rejects(()=>x.service.review(admin,{paymentId:p.id,decision:'rejected'}),/Rejection reason/);
 const r=await x.service.review(admin,{paymentId:p.id,decision:'rejected',note:'Transaction not found'});
 assert.equal(r.decision,'rejected');
 assert.equal((await x.service.paymentsFor(memberId))[0].decision,'rejected');
});
test('file format checks reject a false MIME header',async()=>{
 const x=setup();await enabled(x);
 const spoofed='data:image/jpeg;base64,'+Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64');
 await assert.rejects(()=>x.service.submit(person,{txid:TX2,receipt:spoofed}),/does not match/);
});

test('confirmed transfer to a noncanonical recipient in a historic payment record cannot be approved',async()=>{
 const x=setup();await enabled(x);
 const order=await x.service.submit(person,{txid:TX,receipt:png});
 const stored='cv5/payments/'+order.id+'.json';
 x.saved.set(stored,{...x.saved.get(stored),recipientWallet:'bc1attackercontrolledlegacydestinationxxxxxxxxxxxxxx'});
 const payment=await x.service.paymentById(order.id);
 const check=await x.service.verifyChain(payment);
 assert.equal(check.verified,false);
 assert.match(check.reason,/destination|quoted amount/i);
 await assert.rejects(()=>x.service.review(admin,{
   paymentId:order.id,decision:'approved',confirmedOnChain:true
 }),/not verified/);
});
test('legacy payment without immutable server TXID reservation cannot grant new approval',async()=>{
 const x=setup();await enabled(x);
 const id='11111111-0000-4000-8000-000000000001';
 x.saved.set('cv4/payments/'+id+'.json',{
  id,memberId,txid:TX,priceBTC:0.0002,network:'BTC mainnet',
  recipientWallet:WALLET,status:'pending',decision:null
 });
 const check=await x.service.verifyChain(await x.service.paymentById(id));
 assert.equal(check.verified,false);
 assert.match(check.reason,/reservation/i);
 await assert.rejects(()=>x.service.review(admin,{
  paymentId:id,decision:'approved',confirmedOnChain:true
 }),/not verified/);
});
test('mismatched or missing transaction reservations prevent approval',async()=>{
 const x=setup();await enabled(x);
 const order=await x.service.submit(person,{txid:TX,receipt:png});
 const reservation='cv5/txid-reservations/'+TX+'.json';
 const original=x.saved.get(reservation);
 for(const mutated of [undefined,{...original,paymentId:'bad'}, {...original,memberId:admin.uid}]){
  if(mutated)x.saved.set(reservation,mutated);
  else x.saved.delete(reservation);
  const verified=await x.service.verifyChain(await x.service.paymentById(order.id));
  assert.equal(verified.verified,false);
 }
});
