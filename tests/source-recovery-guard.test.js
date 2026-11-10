'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),path=require('node:path'),
 {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'recovery-manifest.json'),'utf8'));
const script=fs.readFileSync(path.join(root,'scripts/recover-missing-originals.mjs'),'utf8');
test('source recovery manifest preserves provenance for exactly 11 out of 104 original files',()=>{
 assert.equal(manifest.sourceFileCount,104);
 assert.equal(manifest.recoveredFiles.length,93);
 assert.equal(manifest.missingFiles.length,11);
 assert.equal(manifest.sourceFileCount,manifest.recoveredFiles.length+manifest.missingFiles.length);
 for(const file of manifest.missingFiles){
  assert.match(file.path,/^(?:api|lib|tests)\/[a-z0-9.-]+\.js$/);
  assert.match(file.sha1,/^[a-f0-9]{40}$/);
 }
});
test('original recovery script verifies full SHA1 before writing outside application code',()=>{
 assert.match(script,/createHash\('sha1'\)/);
 assert.match(script,/!==f\.sha1/);
 assert.match(script,/join\(dir,f\.path\)/);
 assert.match(script,/vercel-recovered/);
 assert.match(script,/open\(output,'wx'\)/);
 assert.match(script,/source tree SHA1 differs/);
 assert.ok(!script.includes('createHash("sha256").update(bytes)'), 'Never replace SHA1 source-byte evidence');
 const ignored=fs.readFileSync(path.join(root,'.gitignore'),'utf8');
 assert.match(ignored,/vercel-recovered\//);
});
test('source recovery refuses missing private access token without contacting Vercel',()=>{
 const child=spawnSync(process.execPath,['scripts/recover-missing-originals.mjs'],{
  cwd:root,env:{PATH:process.env.PATH||''},encoding:'utf8',timeout:12000});
 assert.notEqual(child.status,0);
 assert.match(child.stderr,/VERCEL_TOKEN is required/);
});
