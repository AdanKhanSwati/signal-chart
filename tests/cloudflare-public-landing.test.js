'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('Public marketing page links to live portal and mobile web app without promising active payments',()=>{
 const s=read('launch.html');
 for(const p of ['/terminal.html','/account.html','/dashboard.html','/app.html'])assert.ok(s.includes('href="'+p+'"'));
 assert.match(s,/Checkout, automatic premium signals and trial activation remain unavailable/);
 assert.match(s,/Trading can result in loss/);
 assert.doesNotMatch(s,/guaranteed returns|\d+% win rate/i);
});
test('Root path maps to public landing without modifying other app routes',()=>{
 const s=read('cloudflare/worker.mjs');
 assert.match(s,/url\.pathname==='\/'&&\(request\.method==='GET'\|\|request\.method==='HEAD'\)/);
 assert.match(s,/new URL\('\/launch\.html',request\.url\)/);
});
test('Allowlisted launch files export without backend code',()=>{
 const a=JSON.parse(read('cloudflare/public-assets.json')).files;
 for(const f of ['launch.html','launch.css','launch.js'])assert.ok(a.includes(f));
});
test('Snapshot avoids fabricated quotes or stale market claim',()=>{
 const s=read('launch.js');
 assert.match(s,/api\/candles/);
 assert.match(s,/Source temporarily unavailable/);
 assert.doesNotMatch(s,/Math\.random|fakePrice/);
});
test('Cloudflare invokes the Worker on root rather than serving index.html before route dispatch',()=>{
 const config=JSON.parse(read('cloudflare/wrangler.staging.json'));
 assert.ok(config.assets.run_worker_first.includes('/'),'Root must pass through Worker to reach landing page');
 assert.ok(config.assets.run_worker_first.includes('/api/*'),'API endpoints must still pass through Worker');
 assert.equal(config.assets.directory,'../.cloudflare-dist');
});
