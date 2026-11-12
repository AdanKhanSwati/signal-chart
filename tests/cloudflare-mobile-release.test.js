'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const r=f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8');
test('Customer mobile uses migrated candle API instead of unavailable crypto quotes API',()=>{
 const src=r('sc-app.js');
 assert.match(src,/\/api\/candles\?market=crypto&symbol=/);
 assert.doesNotMatch(src,/\/api\/quotes\?market=crypto/);
 assert.match(src,/price>0&&stamp>0&&data\.source/);
 assert.match(src,/Dated price history · 24h change unavailable/);
 assert.match(src,/Market data temporarily unavailable/);
});
test('Market snapshot reports quote currency truthfully and does not fabricate 24h changes',()=>{
 const src=r('sc-app.js'),html=r('app.html');
 assert.match(src,/data\.quoteCurrency\|\|'USDT'/);
 assert.match(src,/findLast\(b=>Number\(b\.time\)<=stamp-24\*3600/);
 for(const s of ['BTC','ETH','SOL'])assert.ok(html.includes('id="app-market-'+s+'">'+s+' / USDT</span>'));
});
test('Customer PWA and operations push service workers have isolated scopes',()=>{
 const customer=r('sc-app.js'),ops=r('site-app.js'),sw=r('customer-sw.js');
 assert.match(customer,/customer-sw\.js'.*scope:'\/app\.html'/);
 assert.match(ops,/ops-sw\.js'.*scope:'\/ops\.html'/);
 assert.doesNotMatch(customer,/register\('\/ops-sw\.js'/);
 assert.doesNotMatch(sw,/caches\.open|indexedDB|pushManager|showNotification/);
 assert.ok(JSON.parse(r('cloudflare/public-assets.json')).files.includes('customer-sw.js'));
});

test('App source labels always match their source exchange and quote currency',()=>{
 const app=r('sc-app.js'),live=r('sc-app-live.js'),html=r('app.html');
 assert.match(app,/app-market-'\+short/);
 assert.match(app,/data\.quoteCurrency\|\|'USDT'/);
 assert.match(app,/Spot reference/);
 assert.match(live,/Binance Futures · live ticker/);
 for(const s of ['BTC','ETH','SOL'])assert.ok(html.includes('app-provider-'+s));
});
