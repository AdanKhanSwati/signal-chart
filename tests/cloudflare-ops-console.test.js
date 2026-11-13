'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');
test('Standalone superadmin console uses isolated auth and never links to customer signup',()=>{
 const html=read('ops.html'),js=read('ops-console.js');
 assert.match(html,/PRIVATE OPERATIONS/);assert.match(html,/id="op-app" hidden/);
 assert.match(html,/src="\/ops-console\.js"/);
 assert.doesNotMatch(html,/site-app\.js|signalchart-shell\.js|href="\/account\.html"/);
 assert.match(js,/storageKey='signalchart-superadmin-auth-v1'/);
 assert.match(js,/\/api\/admin-session/);
 assert.match(js,/auth\.getSession\(\)/);
 assert.match(js,/auth\.signOut\(\)/);
 assert.match(js,/location\.replace\('\/admin\/login'\)/);
 assert.match(js,/adminToken\(\)/);
});
test('Operations view shows real statistics and honest locked billing states',()=>{
 const html=read('ops.html'),js=read('ops-console.js');
 for(const id of ['op-kpi-members','op-kpi-open','op-kpi-resolved','op-kpi-paid','op-member-reconcile','op-inbox-error','op-auth-message'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/No payment approvals are available on staging/);
 assert.match(html,/Member modifications are disabled/);
 assert.match(js,/\/api\/admin-overview/);
 assert.match(js,/response\.status===401\|\|response\.status===403/);
 assert.doesNotMatch(js,/Math\.random|fakeMembers|demoPayments/);
});
test('Private support UI uses allowlisted API, textContent and explicit request errors',()=>{
 const html=read('ops.html'),js=read('ops-console.js');
 assert.match(js,/\/api\/cv-ops\?action=admin_support/);
 assert.match(js,/\/api\/cv-ops\?action=messages/);
 assert.match(js,/\/api\/cv-ops\?action=reply/);
 assert.match(js,/\/api\/cv-ops\?action=close_ticket/);
 assert.match(js,/node\.textContent/);
 assert.match(js,/tickets=\[\];clearThread\(\)/);
 assert.match(html,/id="op-reply-form" hidden/);
 assert.doesNotMatch(js,/innerHTML/);
});
test('Admin console has viewport-aware mobile grids, no browser blue focus ring and a reviewed asset allowlist',()=>{
 const css=read('ops-console.css');
 assert.match(css,/@media\(max-width:880px\)/);
 assert.match(css,/@media\(max-width:580px\)/);
 assert.match(css,/focus-visible/);
 assert.match(css,/-webkit-tap-highlight-color:transparent/);
 assert.match(css,/grid-template-columns:1fr/);
 assert.match(css,/Manrope/);
 const assets=JSON.parse(read('cloudflare/public-assets.json')).files;
 for(const name of ['ops.html','ops-console.css','ops-console.js'])assert.ok(assets.includes(name));
});
