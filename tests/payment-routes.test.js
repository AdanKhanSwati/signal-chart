'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const cv=require('../api/cv-ops').createHandler;
const checkout=require('../api/checkout').createHandler;
const member=require('../api/member').createHandler;
const UID='11111111-1111-4111-8111-111111111111';
function setup(isAdmin=false){
 const calls={review:[],submit:0};
 const core={
 identity:async req=>{if(!req.headers.authorization)throw Object.assign(Error('Sign in required'),{status:401});return {uid:UID,email:'user@example.test'}},
 member:async person=>({uid:person.uid,email:person.email,status:'locked',access:false,isAdmin}),
 adminOnly:a=>{if(!a.isAdmin)throw Object.assign(Error('Administrator required'),{status:403})},
 securePost:req=>req.body||{},
 handleError:(res,e)=>res.status(e.status||500).json({error:e.message}),
 records:async()=>[]
 };
 const service={
  billing:async()=>({btcMonthly:0.0002,enabled:false,network:'BTC mainnet',wallet:'bc1example',priceUSD:20}),
  paymentsFor:async()=>[],allPayments:async()=>[],displayPayment:async x=>x,
  submit:async()=>{calls.submit++;return {id:'payment-id',decision:'pending'}},
  review:async(_,body)=>{calls.review.push(body);return {decision:body.decision}},
  quote:async()=>({btcMonthly:0.0002}),
  paymentById:async()=>({id:'payment-id',uid:UID,email:'user@example.test'}),
  reviewOf:async()=>null,verifyChain:async()=>({verified:false}),
  receipt:async()=>({bytes:Buffer.from([137,80,78,71]),mime:'image/png'}),
  saveBilling:async()=>({enabled:false})
 };
 async function request(handler,{method='GET',action='me',body={},token=true,query={}}={}){
  const res={statusCode:200,headers:{},data:null,
   setHeader(n,v){this.headers[n]=v;return this},status(c){this.statusCode=c;return this},
   json(v){this.data=v;return this},end(v){this.data=v;return this}};
  await handler({method,query:{action,...query},body,
    headers:{...(token?{authorization:'Bearer mocked-token'}:{}),'content-type':'application/json'}},res);
  return res;
 }
 return {core,service,calls,request};
}
test('customer can read own membership but not admin payment queue',async()=>{
 const x=setup(false),h=cv(x.core,x.service);
 assert.equal((await x.request(h)).statusCode,200);
 assert.equal((await x.request(h,{action:'admin'})).statusCode,403);
 assert.equal((await x.request(h,{method:'POST',action:'review_payment'})).statusCode,403);
});
test('unauthenticated customer cannot submit screenshot',async()=>{
 const x=setup(false),h=cv(x.core,x.service);
 const r=await x.request(h,{method:'POST',action:'submit_payment',token:false});
 assert.equal(r.statusCode,401);assert.equal(x.calls.submit,0);
});
test('manual customer submission is pending and never approves itself',async()=>{
 const x=setup(false),h=cv(x.core,x.service);
 const r=await x.request(h,{method:'POST',action:'submit_payment'});
 assert.equal(r.statusCode,201);assert.equal(r.data.decision,'pending');
 assert.equal(x.calls.review.length,0);
});
test('admin rejection and read-only screenshot are authenticated',async()=>{
 const x=setup(true),h=cv(x.core,x.service);
 const payment=await x.request(h,{action:'receipt',query:{id:'payment-id'}});
 assert.equal(payment.statusCode,200);assert.equal(payment.headers['Content-Type'],'image/png');
 const reject=await x.request(h,{method:'POST',action:'review_payment',body:{decision:'rejected',paymentId:'payment-id',note:'Not found'}});
 assert.equal(reject.statusCode,200);assert.equal(x.calls.review[0].decision,'rejected');
});
test('checkout verification and approval are admin-only, quote stays public',async()=>{
 const x=setup(false),h=checkout(x.core,x.service);
 assert.equal((await x.request(h,{action:'quote',token:false})).statusCode,200);
 assert.equal((await x.request(h,{action:'verify',query:{paymentId:'payment-id'}})).statusCode,403);
 assert.equal((await x.request(h,{method:'POST',action:'approve',body:{paymentId:'payment-id'}})).statusCode,403);
});
test('admin approval never trusts client claim of blockchain verification',async()=>{
 const x=setup(true),h=checkout(x.core,x.service);
 const r=await x.request(h,{method:'POST',action:'approve',body:{paymentId:'payment-id'}});
 assert.equal(r.statusCode,200);assert.equal(x.calls.review[0].decision,'approved');
 assert.equal(x.calls.review[0].confirmedOnChain,true);
 // Real service.review performs a new chain lookup after the approval button is clicked.
});
test('old member API reads the same locked account state',async()=>{
 const x=setup(false),h=member(x.core,x.service);
 const r=await x.request(h,{action:'me'});
 assert.equal(r.statusCode,200);assert.equal(r.data.account.access,false);
 const denied=await x.request(h,{action:'admin_users'});
 assert.equal(denied.statusCode,403);
});
