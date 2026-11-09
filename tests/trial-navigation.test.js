'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('forex and crypto pages link to the same protected premium signal vault',()=>{
 for(const file of ['forex.html','crypto.html']){
  const html=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  assert.ok(html.includes('href="/signals.html"'),file+' missing Signals navigation');
  assert.ok(html.includes('href="/account.html"'),file+' missing Membership navigation');
 }
});
test('vault includes trial frontend and server unlock endpoint',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../signals.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'../sc-trial-ui.js'),'utf8');
 assert.ok(html.includes('id="sc-trial-signals"'));
 assert.ok(html.includes('/sc-trial-ui.js'));
 assert.ok(js.includes("/api/premium-signals?action=unlock"));
 assert.ok(js.includes("method:'POST'"));
});
