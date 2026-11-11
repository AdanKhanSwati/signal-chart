'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {normalizeEvidence,verifyEvidence,writePrivateReport,safeRelative}=require('../scripts/verify-blob-evidence.cjs');
const bytes=Buffer.from('{"paid":false,"note":"untrusted evidence"}');
const sha=crypto.createHash('sha256').update(bytes).digest('hex');
const inventory=(entries=[{pathname:'cv5/payments/p1.json',size:bytes.length}])=>({
 source:'vercel_blob_list',complete:true,blobs:entries.map(e=>({...e,uploadedAt:'2026-11-01T00:00:00Z'}))
});
const evidence=(entries=[{pathname:'cv5/payments/p1.json',file:'p1.json',sha256:sha}])=>({
 source:'vercel_blob_recovery',objects:entries
});
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sc-evidence-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'p1.json'),bytes);
 return dir;
}
test('Offline preflight hashes recovered bytes but never treats them as paid access',t=>{
 const root=fixture(t);
 const result=verifyEvidence(inventory(),evidence(),{evidenceDir:root});
 assert.equal(result.objects.length,1);
 assert.equal(result.objects[0].content_sha256,sha);
 assert.equal(result.objects[0].verification_level,'local_digest_matches_manifest');
 assert.equal(result.objects[0].source_authenticity_verified,false);
 assert.equal(result.objects[0].access_granted,false);
 assert.equal(result.objects[0].review_status,'pending');
 assert.equal(result.summary.entitlementsGranted,0);
 assert.equal(result.summary.sourceAuthenticityVerified,0);
 assert.ok(!JSON.stringify(result.summary).includes('cv5/payments'));
});
test('A complete source inventory is mandatory; unknown objects cannot enter the preflight',t=>{
 const root=fixture(t);
 assert.throws(()=>verifyEvidence({...inventory(),complete:false},evidence(),{evidenceDir:root}),/complete/);
 assert.throws(()=>verifyEvidence(inventory(),evidence([{pathname:'other.json',file:'p1.json'}]),{evidenceDir:root}),/not in/);
});
test('Duplicate objects and path traversal are rejected',()=>{
 assert.throws(()=>normalizeEvidence(evidence([
  {pathname:'cv5/payments/p1.json',file:'p1.json'},
  {pathname:'cv5/payments/p1.json',file:'p1.json'}
 ]),inventory()),/Duplicate/);
 for(const value of ['../outside','a/../outside','/tmp/outside','a\\outside','a//b','./p1.json'])
  assert.equal(safeRelative(value),false);
 assert.throws(()=>normalizeEvidence(evidence([{pathname:'cv5/payments/p1.json',file:'../outside'}]),inventory()),/Unsafe/);
});
test('Source size mismatch rejects even a locally valid digest',t=>{
 const root=fixture(t);
 assert.throws(()=>verifyEvidence(inventory([{pathname:'cv5/payments/p1.json',size:bytes.length+1}]),evidence(),{evidenceDir:root}),/size/);
});
test('Incorrect digest fails closed, and a matching digest is only a local check',t=>{
 const root=fixture(t);
 assert.throws(()=>verifyEvidence(inventory(),evidence([{pathname:'cv5/payments/p1.json',file:'p1.json',sha256:'a'.repeat(64)}]),{evidenceDir:root}),/digest/);
 const result=verifyEvidence(inventory(),evidence([{pathname:'cv5/payments/p1.json',file:'p1.json'}]),{evidenceDir:root});
 assert.equal(result.objects[0].verification_level,'local_bytes_hashed');
 assert.equal(result.objects[0].source_authenticity_verified,false);
});
test('Symlink evidence is refused even if it resolves inside the evidence directory',t=>{
 const root=fixture(t);
 fs.symlinkSync(path.join(root,'p1.json'),path.join(root,'link.json'));
 assert.throws(()=>verifyEvidence(inventory(),evidence([{pathname:'cv5/payments/p1.json',file:'link.json'}]),{evidenceDir:root}),/regular file/);
});
test('Malformed JSON and unsupported file types are rejected',t=>{
 const root=fixture(t);
 fs.writeFileSync(path.join(root,'p1.json'),Buffer.from('{not json}'));
 assert.throws(()=>verifyEvidence(inventory([{pathname:'cv5/payments/p1.json',size:10}]),evidence([{pathname:'cv5/payments/p1.json',file:'p1.json'}]),{evidenceDir:root}),/JSON/);
 const invalid=Buffer.from('fake image');
 fs.writeFileSync(path.join(root,'p1.png'),invalid);
 assert.throws(()=>verifyEvidence(inventory([{pathname:'cv5/payments/p1.png',size:invalid.length}]),evidence([{pathname:'cv5/payments/p1.png',file:'p1.png'}]),{evidenceDir:root}),/format/);
});
test('A private report is created with 0600 permissions and never overwritten',t=>{
 const root=fixture(t);
 const out=path.join(root,'private-review.json');
 const result=verifyEvidence(inventory(),evidence(),{evidenceDir:root});
 writePrivateReport(out,result);
 assert.equal(fs.statSync(out).mode&0o777,0o600);
 assert.equal(JSON.parse(fs.readFileSync(out,'utf8')).objects[0].content_sha256,sha);
 assert.throws(()=>writePrivateReport(out,result),/EEXIST/);
});
test('No recovered evidence means no review report and no access grants',()=>{
 assert.throws(()=>normalizeEvidence({source:'vercel_blob_recovery',objects:[]},inventory()),/Invalid/);
});
