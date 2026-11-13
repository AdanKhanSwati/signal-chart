'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const read=p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');
const worker=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
test('Admin root redirects only to private login and never customer entry',async()=>{
 const {createWorker}=await worker;
 const app=createWorker({fetchFn:async()=>{throw Error('No backend request should occur')}});
 const r=await app.fetch(new Request('https://admin.example.test/admin/'),{});
 assert.equal(r.status,302);
 assert.equal(r.headers.get('Location'),'/admin/login');
 assert.match(r.headers.get('Cache-Control'),/no-store/);
 assert.equal((await app.fetch(new Request('https://admin.example.test/admin/',{method:'POST'}),{})).status,405);
});
test('Only verified admin console can register admin-only service worker and install button',()=>{
 const html=read('ops.html'),js=read('ops-console.js'),sw=read('ops-sw.js');
 assert.match(html,/id="op-install" class="op-outline" hidden/);
 assert.match(js,/beforeinstallprompt/);
 assert.match(js,/navigator\.serviceWorker\.register\('\/admin\/sw\.js',\{scope:'\/admin\/'\}\)/);
 const start=js.indexOf("const proof=await request('/api/admin-session')");
 const register=js.indexOf("navigator.serviceWorker.register('/admin/sw.js'");
 assert.ok(register>start,'service worker cannot register before verification');
 assert.match(sw,/pathname\.startsWith\('\/admin\/'\)/);
 assert.doesNotMatch(sw,/caches\.open|indexedDB|localStorage/);
 assert.doesNotMatch(read('sc-app.js'),/admin\/sw\.js/);
});
