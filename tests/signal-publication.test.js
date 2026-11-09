'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../api/signal-publication');
const ADMIN='33333333-3333-4333-8333-333333333333';
function setup(isAdmin=true){
 const calls=[];
 const core={
  identity:async req=>{
   if(!req.headers?.authorization)throw Object.assign(Error('Sign-in required'),{status:401});
   return {uid:ADMIN};
  },
  member:async()=>({isAdmin}),
  adminOnly:account=>{if(!account.isAdmin)throw Object.assign(Error('Admin only'),{status:403})},
  securePost:req=>req.body,
  handleError:(res,e)=>res.status(e.status||500).json({error:e.message})
 };
 const gate={rpc:async(name,params)=>{calls.push({name,params});return name==='sc_propose_premium_signal'
  ?{proposalId:'11111111-1111-4111-8111-111111111111',published:false,status:'pending'}
  :{published:true,status:'approved'}}};
 async function run(action,body,method='POST',authorized=true){
  const req={query:{action},method,body,headers:authorized?{authorization:'Bearer token'}:{}};
  const res={code:200,headers:{},data:null,setHeader(k,v){this.headers[k]=v;return this},
   status(v){this.code=v;return this},json(v){this.data=v;return this}};
  await createHandler(core,gate)(req,res);return res;
 }
 return{run,calls};
}
const proposal={
 signalKey:'crypto:btc:20261109:1',market:'crypto',asset:'BTCUSDT',
 candleClosedAt:'2026-11-09T18:00:00Z',source:'Binance USD-M Futures',
 analysis:{direction:'LONG',entry:100,stopLoss:98,takeProfit:105,
  research:'A documented technical setup requiring independent review against a completed market candle and a current economic calendar.',
  evidenceUrl:'https://www.binance.com/en/futures/BTCUSDT'}
};
test('publishing accepts only authenticated administrators and POST',async()=>{
 const admin=setup(),normal=setup(false);
 assert.equal((await admin.run('submit',proposal,'GET')).code,405);
 assert.equal((await admin.run('submit',proposal,'POST',false)).code,401);
 assert.equal((await normal.run('submit',proposal)).code,403);
 assert.equal(admin.calls.length,0);
 assert.equal(normal.calls.length,0);
});
test('proposing is private and never advertises automatic publication',async()=>{
 const x=setup(),res=await x.run('submit',proposal);
 assert.equal(res.code,201);
 assert.equal(res.data.published,false);
 assert.equal(res.data.status,'pending');
 assert.equal(x.calls.length,1);
 assert.equal(x.calls[0].name,'sc_propose_premium_signal');
 assert.equal(x.calls[0].params.p_actor,ADMIN);
 assert.equal(x.calls[0].params.p_analysis.direction,'LONG');
 assert.equal(res.headers['Cache-Control'],'no-store, private');
});
test('manual decision requires an audited reason and review identifier',async()=>{
 const x=setup();
 const invalid=await x.run('review',{proposalId:'bad',decision:'approve',reason:'yes'});
 assert.equal(invalid.code,400);assert.equal(x.calls.length,0);
 const review=await x.run('review',{proposalId:'11111111-1111-4111-8111-111111111111',
  decision:'approve',reason:'Reviewed candle evidence and stop/target placement'});
 assert.equal(review.code,200);assert.equal(review.data.published,true);
 assert.equal(x.calls[0].name,'sc_review_premium_signal');
 assert.equal(x.calls[0].params.p_actor,ADMIN);
});
