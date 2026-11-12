'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const scan=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/auto-scanner.mjs')).href);
const audit=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/scan-audit.mjs')).href);

test('Scanner diagnostics produce bounded categories instead of upstream error messages',async()=>{
 const {classifyScanError}=await scan;
 assert.equal(classifyScanError(Error('Stale or unclosed market candle')),'STALE_CANDLES');
 assert.equal(classifyScanError(Error('Not enough verified completed candles')),'INSUFFICIENT_HISTORY');
 assert.equal(classifyScanError(Error('Discontinuous recent hourly candles')),'GAPPED_CANDLES');
 assert.equal(classifyScanError(Error('Insufficient Kraken spot candles')),'INCOMPLETE_SOURCE');
 assert.equal(classifyScanError(Error('Invalid exchange response')),'INVALID_SOURCE');
 assert.equal(classifyScanError(Error('HTTP 403 Bearer secret: topsecret')),'PROVIDER_UNAVAILABLE');
 assert.equal(classifyScanError({message:'user@example.com password=secret'}),'PROVIDER_UNAVAILABLE');
});
test('Audit records only validated market/outcome/source diagnostic fields',async()=>{
 const {safeScanResults,scanAuditPayload}=await audit;
 const safe=safeScanResults({results:[
  {market:'crypto',symbol:'BTCUSDT',status:'NO_SETUP',source:'Bybit USDT linear perpetual',
   closePrice:100.7,secretKey:'never store me'},
  {market:'crypto',symbol:'ADAUSDT',status:'DATA_UNAVAILABLE',
   diagnostic:'STALE_CANDLES',message:'private server header'},
  {market:'forex',symbol:'EURUSD',status:'INDICATIVE_ONLY',
   source:'Yahoo Finance indicative FX',stopLoss:0.8},
  {market:'forex',symbol:'ETHUSDT',status:'DATA_UNAVAILABLE',diagnostic:'CUSTOM_SECRET'},
  {market:'payment',symbol:'ABCCDE',status:'NO_SETUP'},
  {market:'crypto',symbol:'BTCUSDT',status:'PRIVATE_USER_GRANTED'},
  {market:'crypto',symbol:'BTC/USD',status:'NO_SETUP'}
 ]});
 assert.deepEqual(safe,[
  {symbol:'BTCUSDT',market:'crypto',status:'NO_SETUP',source:'Bybit USDT linear perpetual'},
  {symbol:'ADAUSDT',market:'crypto',status:'DATA_UNAVAILABLE',diagnostic:'STALE_CANDLES'},
  {symbol:'EURUSD',market:'forex',status:'INDICATIVE_ONLY',source:'Yahoo Finance indicative FX'},
  {symbol:'ETHUSDT',market:'forex',status:'DATA_UNAVAILABLE'}
 ]);
 const report={status:'PARTIAL_DATA',scanned:4,qualified:0,
  counts:{NO_SETUP:1,DATA_UNAVAILABLE:2,INDICATIVE_ONLY:1},
  newsCoverage:'SINGLE_SOURCE_WEEKLY',results:safe};
 const body=scanAuditPayload(report);
 assert.deepEqual(body.p_metadata.marketChecks,safe);
 assert.equal(body.p_metadata.newsCoverage,'SINGLE_SOURCE_WEEKLY');
 assert.equal(body.p_published,0);
 assert.doesNotMatch(JSON.stringify(body),/closePrice|secretKey|user@example|password|stopLoss/);
});
test('Audit diagnostics reject fake candidate scores and honor a bounded market universe',async()=>{
 const {safeScanResults,scanAuditPayload}=await audit;
 const data=Array.from({length:80},(_,i)=>({
  market:'crypto',symbol:'BTCUSDT',status:'DATA_UNAVAILABLE',
  diagnostic:'PROVIDER_UNAVAILABLE',price:i,privateNote:'do not write'
 }));
 assert.equal(safeScanResults({results:data}).length,24);
 const payload=scanAuditPayload({status:'PARTIAL_DATA',scanned:80,counts:{DATA_UNAVAILABLE:80},
  results:data,newsCoverage:'INVESTIGATION_IGNORED'});
 assert.equal(payload.p_metadata.marketChecks.length,24);
 assert.equal(payload.p_metadata.newsCoverage,null);
 assert.equal(payload.p_metadata.marketChecks[0].price,undefined);
 assert.equal(payload.p_metadata.marketChecks[0].privateNote,undefined);
});
