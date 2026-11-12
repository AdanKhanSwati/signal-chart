'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');

test('Candle API identifies the actual exchange venue without equating spot, swap and futures streams',()=>{
 const api=source('cloudflare/market-candles.mjs');
 assert.match(api,/market,symbol,interval,source,instrument,exchange,/);
 assert.match(api,/instrument='perpetual';exchange='binance'/);
 assert.match(api,/instrument='perpetual';exchange=independent\.exchange/);
 assert.match(api,/instrument='spot';exchange='binance'/);
 assert.match(api,/instrument='spot_reference';exchange='coinbase'/);
 assert.match(api,/instrument='historical_fx';exchange='algospecial'/);
});
test('Terminal accepts Binance WebSocket candles only into Binance perpetual history',()=>{
 const ui=source('market-charts.js');
 assert.match(ui,/exchange:data\.exchange\|\|null/);
 assert.match(ui,/state\.candleSource\?\.instrument!=='perpetual'\|\|state\.candleSource\?\.exchange!=='binance'/);
 const kline=ui.slice(ui.indexOf("window.addEventListener('signalchart:kline'"));
 assert.match(kline,/state\.candleSource\?\.exchange!=='binance'/);
 assert.match(ui,/activeDifferentVenue/);
 assert.match(ui,/if\(!activeDifferentVenue\)state\.quotes\[symbol\]=q/);
 assert.doesNotMatch(ui,/if\(lookup\[symbol\]\)state\.quotes\[symbol\]=q/);
});
test('Source-specific 2-minute candle refresh is used when streaming venue differs',()=>{
 const ui=source('market-charts.js');
 assert.match(ui,/state\.candleSource\?\.exchange!=='binance'/);
 assert.match(ui,/state\.candleSource\?\.instrument!=='perpetual'/);
 assert.match(ui,/\},120000\);/);
 assert.match(ui,/state\.candleSource=\{symbol,source:data\.source/);
});
