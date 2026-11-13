'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const source=p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');
const importer=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const routes={'/admin/login':'/admin-login.html','/admin/console':'/ops.html',
 '/admin/manifest.webmanifest':'/ops.webmanifest','/admin/sw.js':'/ops-sw.js'};
test('Private admin URLs serve only dedicated assets and never customer screens',async()=>{
 const {createWorker}=await importer;
 const requests=[];
 const worker=createWorker({fetchFn:async()=>{throw Error('No auth backend for static alias')}});
 const env={ASSETS:{fetch:async req=>{
  const u=new URL(req.url);requests.push(u.pathname);
  return new Response('STATIC:'+u.pathname,{headers:{'Content-Type':u.pathname.endsWith('.webmanifest')?'application/manifest+json':'text/html'}});
 }}};
 for(const [url,asset] of Object.entries(routes)){
  const res=await worker.fetch(new Request('https://staging.example.test'+url),env);
  assert.equal(res.status,200);
  assert.equal(await res.text(),'STATIC:'+asset);
  assert.equal(res.headers.get('X-Robots-Tag'),'noindex, nofollow');
  assert.match(res.headers.get('Cache-Control'),/no-store/);
  if(url==='/admin/sw.js')assert.equal(res.headers.get('Service-Worker-Allowed'),'/admin/');
 }
 assert.deepEqual(requests,Object.values(routes));
 assert.equal((await worker.fetch(new Request('https://staging.example.test/admin/console',{method:'POST'}),env)).status,405);
});
test('Admin PWA install scope and customer PWA cannot overlap as navigation scopes',()=>{
 const ops=JSON.parse(source('ops.webmanifest')),customer=JSON.parse(source('customer.webmanifest'));
 assert.equal(ops.id,'/admin/');
 assert.equal(ops.start_url,'/admin/login');
 assert.equal(ops.scope,'/admin/');
 assert.ok(!customer.start_url.startsWith(ops.scope));
 assert.match(source('admin-login.html'),/href="\/admin\/manifest\.webmanifest"/);
 assert.match(source('ops.html'),/href="\/admin\/manifest\.webmanifest"/);
});
test('Customer surface has no superadmin navigation and console no customer scripts',()=>{
 const customer=source('account.html'),ops=source('ops.html'),platform=source('app.html');
 assert.doesNotMatch(customer,/href="\/admin(?:\.html|\/console)"/);
 assert.doesNotMatch(platform,/href="\/admin(?:\.html|\/console)"/);
 assert.doesNotMatch(ops,/signalchart-shell\.js|site-app\.js|premium\.css|styles\.css/);
 assert.match(source('ops-console.js'),/location\.replace\('\/admin\/login'\)/);
 assert.match(source('admin-auth.js'),/location\.replace\('\/admin\/console'\)/);
});
test('Android superadmin flavor enters only the private path while customers are excluded',()=>{
 const gradle=source('mobile/android/app/build.gradle'),policy=source('mobile/android/app/src/main/java/pro/signalchart/app/UrlPolicy.java');
 assert.match(gradle,/START_PATH', '"\/admin\/login"'/);
 assert.match(gradle,/entryPath: '\/admin\/login'/);
 assert.match(policy,/"\/admin\/login", "\/admin\/console"/);
 assert.doesNotMatch(policy,/"\/ops\.html", "\/admin\.html"/);
 assert.match(source('ops-sw.js'),/\/admin\/console/);
});
test('Worker admin scope is explicitly enabled before generic static routes',()=>{
 const w=JSON.parse(source('cloudflare/wrangler.staging.json'));
 assert.ok(w.assets.run_worker_first.includes('/admin/*'));
 assert.ok(w.assets.run_worker_first.includes('/api/*'));
});
