'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../market-charts.js'),'utf8');
test('Published reference is rendered only as daily LINE series when forex candle endpoint fails',()=>{
 assert.match(src,/async function renderDailyReference\(p,id\)/);
 assert.match(src,/if\(p\.type!=='forex'\)return false/);
 assert.match(src,/\/api\/fx-daily-reference\?symbol=/);
 assert.match(src,/chart\.addLineSeries/);
 assert.doesNotMatch(src.slice(src.indexOf('async function renderDailyReference'),src.indexOf('async function renderHostedChart')),/addCandlestickSeries|renderWithLibrary|evaluate\(/);
 assert.match(src,/if\(p\.type==='forex'&&await renderDailyReference\(p,id\)\)return/);
});
test('No derived OHLC, indicators, live claim or premium signal can come from daily rates',()=>{
 const section=src.slice(src.indexOf('async function renderDailyReference'),src.indexOf('async function renderHostedChart'));
 assert.match(section,/state\.bars=\[\];showIndicators\(\)/);
 assert.match(section,/reference:true/);
 assert.match(section,/daily_reference/);
 assert.match(section,/Intraday OHLC unavailable · Not a broker quote/);
 assert.doesNotMatch(section,/setData\(.*open|premiumUnlock|fakeHistory/);
});
test('Daily reference refresh is throttled, but manual interval or pair change can retry live OHLC',()=>{
 assert.match(src,/referenceNextRetry:0/);
 assert.match(src,/state\.referenceNextRetry=Date\.now\(\)\+900000/);
 assert.match(src,/state\.candleSource\?\.instrument==='daily_reference'&&Date\.now\(\)<state\.referenceNextRetry/);
 assert.match(src,/state\.referenceNextRetry=0;const p=lookup\[s\]/);
});
