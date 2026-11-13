'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8');
const workerImport=import(require('node:url').pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
const UID='a24525be-6539-4a7d-b590-37b12c41f09c';
const token='jwt.admin.token.valid-12345678901234567890';
const env={SUPABASE_URL:'https://test-admin.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'};
const upstream=async(_url,opts)=>new Response(JSON.stringify({
 id:UID,email:'superadmin@example.test',email_confirmed_at:'2026-11-11T00:00:00Z',
 user_metadata:{role:'customer',isAdmin:false}
}),{status:opts.headers?.Authorization==='Bearer '+token?200:401,headers:{'content-type':'application/json'}});
const request=(auth,method='GET')=>new Request('https://staging.example.test/api/admin-session',{method,headers:auth?{Authorization:'Bearer '+token}:{}});
test('Dedicated server admin session endpoint denies missing JWT and non-admin users',async()=>{
 const {createWorker}=await workerImport;
 const w=createWorker({fetchFn:upstream});
 assert.equal((await w.fetch(request(false),{...env,SC_SUPER_ADMIN_UID:UID})).status,401);
 assert.equal((await w.fetch(request(true),env)).status,403);
 assert.equal((await w.fetch(request(true),{...env,SC_SUPER_ADMIN_UID:'11111111-1111-4111-8111-111111111111'})).status,403);
 assert.equal((await w.fetch(request(true,'POST'),{...env,SC_SUPER_ADMIN_UID:UID})).status,405);
});
test('Only configured server UID passes admin session gate; client metadata cannot grant access',async()=>{
 const {createWorker}=await workerImport;
 const response=await createWorker({fetchFn:upstream}).fetch(request(true),{...env,SC_SUPER_ADMIN_UID:UID});
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{authorized:true,role:'super_admin'});
 assert.equal(response.headers.get('Cache-Control'),'private, no-store, max-age=0');
});
test('Administrator sign in has no signup, trial or customer session reuse',()=>{
 const html=root('admin-login.html'),js=root('admin-auth.js'),ops=root('site-app.js');
 assert.match(html,/id="admin-form"/);
 assert.doesNotMatch(html,/create account|sign up|free trial/i);
 assert.match(js,/signInWithPassword/);
 assert.match(js,/shouldCreateUser:false/);
 assert.match(js,/storageKey:adminStorageKey/);
 assert.match(js,/\/api\/admin-session/);
 assert.match(js,/auth\.signOut\(\)/);
 assert.match(ops,/storageKey:'signalchart-superadmin-auth-v1'/);
 assert.match(ops,/\/api\/admin-session/);
 assert.match(ops,/location\.replace\('\/admin-login\.html'\)/);
 assert.doesNotMatch(root('ops.html'),/href="\/account.html\?mode=signin"/);
 assert.doesNotMatch(root('account.html'),/href="\/admin\.html"/);
});
test('Customer app navigation has no admin access while admin APK has its own login',()=>{
 const policy=root('mobile/android/app/src/main/java/pro/signalchart/app/UrlPolicy.java');
 const gradle=root('mobile/android/app/build.gradle');
 assert.match(policy,/"\/admin-login.html", "\/ops.html"/);
 assert.doesNotMatch(policy,/"\/ops.html", "\/admin.html", "\/account.html"/);
 assert.match(gradle,/entryPath: '\/admin-login.html'/);
 assert.match(gradle,/START_PATH', '"\/admin-login.html"'/);
 assert.match(root('admin.html'),/url=\/admin-login.html/);
});
test('Separate administrator files use reviewed allowlist',()=>{
 const list=JSON.parse(root('cloudflare/public-assets.json')).files;
 for(const f of ['admin-login.html','admin-auth.css','admin-auth.js'])assert.ok(list.includes(f),f);
});
