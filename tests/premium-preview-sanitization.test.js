'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../api/premium-signals');
async function request(rows){
 const core={handleError:(res,e)=>res.status(e.status||500).json({error:e.message})};
 const gate={listSignals:async()=>rows};
 const req={method:'GET',query:{action:'list'}};
 const response={code:200,headers:{},data:null,
  setHeader(name,value){this.headers[name]=value;return this},
  status(code){this.code=code;return this},
  json(value){this.data=value;return this}};
 await createHandler(core,gate)(req,response);
 return response;
}
test('public listing strips unexpected premium fields even if upstream returns them',async()=>{
 const data=await request([{signalKey:'crypto:btc:first',market:'crypto',asset:'BTCUSDT',
  publishedAt:'2026-11-09T10:00:00Z',direction:'BUY',entry:111,
  entryZone:[110,112],stopLoss:104,takeProfit:125,
  premium_data:{target:125,explanation:'private reason'},explanation:'private'}]);
 assert.equal(data.code,200);
 assert.deepEqual(data.data.signals,[{signalKey:'crypto:btc:first',
  market:'crypto',asset:'BTCUSDT',publishedAt:'2026-11-09T10:00:00Z'}]);
 assert.equal(JSON.stringify(data.data).includes('private'),false);
 assert.equal(data.headers['Cache-Control'],'no-store, private');
});
test('malformed premium responses and invalid markets fail closed',async()=>{
 const a=await request([{direction:'SELL',entry:123},{signalKey:'x',market:'stocks',asset:'SPY'}]);
 assert.deepEqual(a.data.signals,[]);
});
