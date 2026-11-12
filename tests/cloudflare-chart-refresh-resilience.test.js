'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../market-charts.js'),'utf8');

test('Background candle refresh snapshots the existing viewport before touching OHLC data',()=>{
 assert.match(source,/const key=symbol\+'\\|'\+interval,previousBars=state\.bars\.length/);
 assert.match(source,/const keepCurrent=!!\(state\.chartKey===key&&previousBars&&\(state\.chart\|\|state\.chartEngine\)\)/);
 assert.match(source,/const range=keepCurrent\?state\.chart\?\.timeScale/);
 assert.match(source,/const follow=range\?range\.to>=previousBars-7:true/);
 assert.match(source,/if\(!keepCurrent\)\{state\.bars=\[\];showIndicators\(\)\}/);
 assert.match(source,/if\(range&&!follow\)state\.chart\.timeScale\(\)\.setVisibleLogicalRange\(range\)/);
});

test('Transient feed failures leave the previous, clearly dated chart available for inspection',()=>{
 assert.match(source,/if\(keepCurrent&&state\.chartKey===key&&state\.bars\.length&&\(state\.chart\|\|state\.chartEngine\)\)/);
 assert.match(source,/Previous candles retained · refresh unavailable/);
 assert.match(source,/if\(e\.name==='AbortError'\|\|id!==state\.loadId\)return/);
 assert.match(source,/await renderHostedChart\(p,interval,id\)/);
});
