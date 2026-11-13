'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');
test('Expanded private console has separate working controls for trials, signals, audit and settings',()=>{
 const html=read('ops.html'),js=read('ops-console.js');
 for(const view of ['trials','signals','audit','settings']){
  assert.match(html,new RegExp('data-op-view="'+view+'"'));
  assert.match(html,new RegExp('id="op-view-'+view+'"'));
  assert.ok(js.includes("'"+view+"'"),view);
 }
 for(const method of ['loadTrialRegister','revokeTrial','loadResearchCenter','loadAuditHistory','changeControl','loadAdminSwitches'])
  assert.match(js,new RegExp('(?:async )?function '+method+'\\('));
});
test('High-risk member and publication controls are not bypassable from admin UI',()=>{
 const html=read('ops.html'),js=read('ops-console.js');
 assert.match(html,/Automatic paid signal publication remains disabled/);
 assert.match(html,/Crypto payment approval/);
 assert.match(html,/Trial reset for existing devices/);
 assert.match(js,/\/api\/admin-control\?action=toggle/);
 assert.match(js,/\/api\/admin-control\?action=revoke_trial/);
 assert.doesNotMatch(js,/approvePayment|startLiveSignalPublication|resetTrialHistory/);
});
test('Admin text rendering is safe and viewport rules cover large and small devices',()=>{
 const js=read('ops-console.js'),css=read('ops-console.css');
 assert.doesNotMatch(js,/innerHTML\s*=/);
 assert.match(js,/node\\.textContent/);
 assert.match(css,/@media\\(max-width:580px\\)/);
 assert.match(css,/\.op-review-grid/);
 assert.match(css,/\.op-sidebar/);
});
