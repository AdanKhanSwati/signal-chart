'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');
test('Payment verification is visible only as an admin-owned review ledger without approval',()=>{
 const h=read('ops.html'),js=read('ops-console.js');
 for(const id of ['op-refresh-payments','op-payment-list','op-payment-details','op-payment-review-form','op-payment-state'])
  assert.match(h,new RegExp('id="'+id+'"'));
 assert.match(h,/No payment approvals are available on staging/);
 assert.doesNotMatch(h,/<option value="approve"/);
 assert.match(js,/\/api\/admin-payments/);
 assert.match(js,/No subscription was activated/);
 assert.match(js,/paymentCapabilities\.canReview===true/);
});
test('Complimentary access changes require member selection, reason and explicit confirmation',()=>{
 const h=read('ops.html'),js=read('ops-console.js');
 for(const id of ['op-member-search-form','op-member-search','op-member-results','op-member-grants','op-grant-form','op-grant-expiry'])
  assert.match(h,new RegExp('id="'+id+'"'));
 assert.match(js,/\/api\/admin-members/);
 assert.match(js,/grantWriteEnabled/);
 assert.match(js,/confirm\('Grant time-limited complimentary access/);
 assert.match(js,/\/api\/admin-members\?action=revoke/);
 assert.match(js,/Date\.now\(\)\+90\*86400000/);
});
test('Admin UI escapes customer strings and has responsive review cards',()=>{
 const js=read('ops-console.js'),css=read('ops-console.css');
 assert.doesNotMatch(js,/innerHTML/);
 assert.match(js,/textContent=String\(value/);
 assert.match(css,/\.op-review-grid/);
 assert.match(css,/@media\(max-width:980px\)/);
 assert.match(css,/\.op-inline-input/);
});
