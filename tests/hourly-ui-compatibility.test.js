'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ui=fs.readFileSync(path.join(__dirname,'../hourly-ui.js'),'utf8');
test('hourly panel reads the actual protected premium signal feed, not a retired endpoint',()=>{
 assert.ok(ui.includes("/api/premium-signals?action=list"));
 assert.equal(ui.includes('/api/research?mode=current'),false);
 assert.ok(ui.includes('#sc-trial-signals'));
});
test('hourly overview never bypasses 72-hour trial credit accounting',()=>{
 assert.equal(ui.includes('/api/premium-signals?action=unlock'),false);
 assert.equal(ui.includes("fetch('/api/premium-signals?action=unlock'"),false);
 assert.ok(ui.includes('Opening this preview does not consume a trial credit.'));
});
test('unverified backend returns NO TRADE or feed unavailable, not fabricated trading levels',()=>{
 assert.ok(ui.includes('No verified qualifying signals are published'));
 assert.ok(ui.includes('No prices or trading directions have been estimated.'));
 assert.equal(ui.includes('item.setup'),false);
 assert.equal(ui.includes('s.stopLoss'),false);
 assert.equal(ui.includes('s.takeProfit1'),false);
});
test('signal previews render with safe textContent rather than injected HTML',()=>{
 assert.ok(ui.includes('e.textContent=String(content)'));
 assert.ok(ui.includes("item.market.toUpperCase()"));
 assert.ok(ui.includes("item.asset"));
 assert.equal(ui.includes('innerHTML'),false);
});
