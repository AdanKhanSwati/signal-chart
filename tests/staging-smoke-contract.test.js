'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {run,lockedEndpoints}=require('../scripts/staging-smoke.cjs');
const origin='https://signalchart-qa.vercel.app';
const validConfig={authProvider:'supabase',trialHours:72,trialSignalLimit:3,
 paymentsEnabled:false,signalsEnabled:false,phoneVerificationEnabled:false};
const successful={
 '/api/config':validConfig,
 '/api/research?mode=health':{unattendedPublishing:{enabled:false}},
 '/api/premium-signals?action=list':{signals:[]},
 '/api/crypto':{items:[]},'/api/forex':{items:[]},'/api/signals':{items:[]},
 '/api/market-detail?market=crypto&symbol=BTCUSDT&interval=1h':{
  market:'crypto',candles:Array.from({length:61},(_,i)=>({time:i,close:100+i})),source:'Verified exchange hourly'},
 '/api/research?mode=calendar&symbol=EURUSD':{coverage:'FULL_WEEK'},
 '/api/checkout?action=quote':{note:'Reference only — not a payable invoice'}
};
function makeFetch({change={},statusChanges={}}={}){
 const calls=[];
 const fetchFn=async (url,options)=>{
  const path=url.slice(origin.length);
  calls.push({path,options});
  assert.equal(options.headers['x-vercel-protection-bypass'],'test-only-bypass');
  assert.equal(options.headers.Authorization,undefined,'Staging anonymous checks must not impersonate a customer');
  assert.equal(options.method,undefined,'Staging smoke checks must only use GET');
  let status,body;
  if(Object.hasOwn(successful,path)){status=200;body=successful[path]}
  else if(lockedEndpoints.includes(path)){status=401;body={error:'Sign in required'}}
  else if(path==='/api/premium-signals?action=unlock'){status=405;body={error:'POST required'}}
  else if(path==='/api/compat?sc_route=../lib/candriva-core'){status=404;body={error:'Unknown route'}}
  else throw Error('Unexpected tested URL '+path);
  return {status:statusChanges[path]??status,json:async()=>change[path]??body};
 };
 return {fetchFn,calls};
}
test('protected preview smoke validates nine public endpoints and seven denial cases',async()=>{
 const x=makeFetch();
 const result=await run({fetchFn:x.fetchFn,origin,bypass:'test-only-bypass'});
 assert.equal(result.status,'PASS');
 assert.equal(result.endpoints,16);
 assert.equal(result.deniedAnonymousPaths,5);
 assert.equal(x.calls.length,16);
 for(const endpoint of lockedEndpoints)assert.equal(x.calls.filter(c=>c.path===endpoint).length,1);
});
test('anonymous member leak is a hard failure even if server responds 200',async()=>{
 const x=makeFetch({statusChanges:{'/api/member?action=me':200},
  change:{'/api/member?action=me':{account:{uid:'leak'}}}});
 await assert.rejects(run({fetchFn:x.fetchFn,origin,bypass:'test-only-bypass'}),/must deny anonymous access/);
});
test('premium public preview rejects entry, stop loss and actionable signal data',async()=>{
 const x=makeFetch({change:{'/api/premium-signals?action=list':{
  signals:[{signalKey:'crypto:BTCUSD:123:long',asset:'BTCUSD',market:'crypto',stopLoss:98000}]
 }}});
 await assert.rejects(run({fetchFn:x.fetchFn,origin,bypass:'test-only-bypass'}),/Premium trading level leaked/);
});
test('live staging smoke fails safely if payments or OTP delivery are enabled',async()=>{
 const pay=makeFetch({change:{'/api/config':{...validConfig,paymentsEnabled:true}}});
 await assert.rejects(run({fetchFn:pay.fetchFn,origin,bypass:'test-only-bypass'}),/Staging must not accept payments/);
 const phone=makeFetch({change:{'/api/config':{...validConfig,phoneVerificationEnabled:true}}});
 await assert.rejects(run({fetchFn:phone.fetchFn,origin,bypass:'test-only-bypass'}),/Staging must not send WhatsApp/);
});
