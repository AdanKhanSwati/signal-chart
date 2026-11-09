'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{analyze}=require('../lib/forex-engine');
function bars(t0){let price=1.1;const r=[];for(let i=0;i<100;i++){const prev=price;price+=(i%5===0?-.0005:.00024);r.push({time:t0+i*900,open:prev,high:Math.max(prev,price)+.00015,low:Math.min(prev,price)-.00015,close:price})}return r}
const started=Math.floor(Date.parse('2026-11-06T00:00:00Z')/1000),sample=bars(started);
test('forex analyzer requires enough real closed candles',()=>{assert.equal(analyze('EURUSD',[],Date.now()).status,'UNAVAILABLE')});
test('closed forex market never fabricates an actionable qualified setup',()=>{const r=analyze('EURUSD',sample,Date.parse('2026-11-08T00:00:00Z'));assert.equal(r.status,'WATCHING');assert.equal(r.direction,null);assert.equal(r.entry,null)});
test('forex analyzer returns legitimate indicator values and timestamp',()=>{const end=Date.parse('2026-11-07T02:00:00Z');const r=analyze('EURUSD',sample,end);assert.ok(['QUALIFIED','WATCHING'].includes(r.status));assert.ok(r.ema20>0&&r.ema50>0);assert.ok(r.rsi14>=0&&r.rsi14<=100);assert.ok(r.atr14>0);assert.ok(r.candleTime)});
test('unsupported forex symbols do not produce a signal',()=>{assert.equal(analyze('BTCUSDT',sample,Date.now()).status,'UNAVAILABLE')});
