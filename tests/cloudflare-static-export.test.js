'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {exportAssets}=require('../scripts/build-cloudflare-static.cjs');
const manifest=require('../cloudflare/public-assets.json');

test('static export uses only a reviewed root-file allowlist, never server or secrets',()=>{
 const names=manifest.files;
 assert.ok(names.includes('index.html'));
 assert.ok(names.includes('account.html'));
 assert.ok(names.includes('signalchart-mark.svg'));
 assert.ok(!names.includes('setup.html'));
 assert.equal(names.length,new Set(names).size);
 for(const name of names){
  assert.ok(!name.includes('/')&&!name.startsWith('.'),name);
  assert.ok(!/(^|[-._])(env|secret|server|config-private)([-._]|$)/i.test(name),name);
 }
});

test('Cloudflare public build contains exactly approved files and no backend folders',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'sc-cloudflare-assets-'));
 const outDir=path.join(base,'public');
 try{
  const result=exportAssets({sourceRoot:root,outDir});
  assert.equal(result.files,manifest.files.length);
  assert.deepEqual(fs.readdirSync(outDir).sort(),[...manifest.files].sort());
  for(const name of ['.env.example','vercel.json','package.json','api','lib','database','supabase','scripts','tests','setup.html'])
   assert.ok(!fs.existsSync(path.join(outDir,name)),name+' must not be published');
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});

test('referenced root JS/CSS/svg/icon files on published HTML are included',()=>{
 const files=new Set(manifest.files);
 for(const page of manifest.files.filter(s=>s.endsWith('.html'))){
  const src=fs.readFileSync(path.join(root,page),'utf8');
  const refs=[...src.matchAll(/(?:src|href)=["'](\/[^"'?#]+)["']/g)];
  for(const m of refs){
   const name=m[1].slice(1);
   if(/\.(?:css|js|svg|png|webmanifest|ico)$/.test(name)){
    if(name==='admin/manifest.webmanifest'){
     assert.ok(['admin-login.html','ops.html'].includes(page),page+' must not use admin manifest');
     assert.ok(files.has('ops.webmanifest'));
     const worker=fs.readFileSync(path.join(root,'cloudflare/worker.mjs'),'utf8');
     assert.match(worker,/\/admin\/manifest\.webmanifest/);
     assert.match(worker,/\/ops\.webmanifest/);
    }else assert.ok(files.has(name),page+' references unlisted '+name);
   }
  }
 }
});
