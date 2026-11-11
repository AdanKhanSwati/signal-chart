'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {
 objectPath,verifyRecoveredFiles,uploadVerifiedObjects,guardedConfig,cli
}=require('../scripts/upload-blob-evidence.cjs');
const data=Buffer.from('{"status":"unknown","paid":false,"note":"not independently verified"}');
const digest=crypto.createHash('sha256').update(data).digest('hex');
const sourceKey='cv2/members/member-qa.json';
const config={
 SUPABASE_URL:'https://qa-instance.supabase.co',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SC_EVIDENCE_UPLOAD_APPROVED:'true'
};
const manifest=()=>({
 source:'vercel_blob_list',complete:true,blobs:[{
  pathname:sourceKey,size:data.length,uploadedAt:'2026-11-10T00:00:00Z'
 }]
});
const evidence=()=>({
 source:'vercel_blob_recovery',objects:[{
  pathname:sourceKey,file:'member.json',sha256:digest
 }]
});
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sc-upload-private-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'member.json'),data);
 return dir;
}
const item=()=>({
 key:objectPath(digest,'application/json'),hash:digest,
 mime:'application/json',bytes:Buffer.from(data)
});
function storageMock({status=200,stored=data,calls=[]}={}){
 return async (url,opts)=>{
  calls.push({url,method:opts.method,headers:opts.headers,body:opts.body});
  if(opts.method==='POST')return new Response(null,{status});
  if(opts.method==='GET')return new Response(stored,{status:200});
  throw Error('Unexpected method');
 };
}
test('Content addressed private paths never include customer source paths or emails',()=>{
 const key=objectPath(digest,'application/json');
 assert.equal(key,'sha256/'+digest.slice(0,2)+'/'+digest+'.json');
 assert.ok(!key.includes('cv2/'));
 assert.ok(!key.includes('member-qa'));
 assert.equal(objectPath(digest,'image/png').endsWith('.png'),true);
 assert.equal(objectPath(digest,'image/jpeg').endsWith('.jpg'),true);
 for(const broken of ['x'.repeat(64),'../private','AA'.repeat(32)])
  assert.throws(()=>objectPath(broken,'application/json'));
 assert.throws(()=>objectPath(digest,'application/pdf'));
});
test('Evidence uploader rechecks local bytes and source inventory before upload',t=>{
 const dir=fixture(t);
 const result=verifyRecoveredFiles(manifest(),evidence(),dir);
 assert.equal(result.objects.length,1);
 assert.equal(result.objects[0].hash,digest);
 assert.deepEqual(result.objects[0].bytes,data);
 assert.equal(result.preflightSummary.entitlementsGranted,0);
 assert.throws(()=>verifyRecoveredFiles({...manifest(),complete:false},evidence(),dir));
 fs.writeFileSync(path.join(dir,'member.json'),Buffer.from('tampered'));
 assert.throws(()=>verifyRecoveredFiles(manifest(),evidence(),dir));
});
test('No upload occurs without independent environment-level approval',async()=>{
 const calls=[],opts={...config,SC_EVIDENCE_UPLOAD_APPROVED:'false'};
 await assert.rejects(uploadVerifiedObjects([item()],{
  env:opts,fetchFn:storageMock({calls})
 }),/Explicit/);
 assert.equal(calls.length,0);
});
test('Only server-side credentials are accepted',()=>{
 assert.throws(()=>guardedConfig({SUPABASE_URL:config.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
  SC_EVIDENCE_UPLOAD_APPROVED:'true'}));
 assert.throws(()=>guardedConfig({
  ...config,SUPABASE_URL:'http://not-a-secure-provider.test'
 }));
});
test('Upload is create-only and follows with an independently hashed private GET',async()=>{
 const calls=[];
 const res=await uploadVerifiedObjects([item()],{
  env:config,fetchFn:storageMock({calls,status:200})
 });
 assert.equal(calls.length,2);
 assert.equal(calls[0].method,'POST');
 assert.equal(calls[1].method,'GET');
 assert.equal(calls[0].url,config.SUPABASE_URL+
  '/storage/v1/object/sc-legacy-evidence/'+item().key);
 assert.deepEqual(calls[0].body,data);
 assert.equal(calls[0].headers['x-upsert'],'false');
 assert.equal(calls[0].headers.apikey,config.SUPABASE_SECRET_KEY);
 assert.equal(calls[0].headers.Authorization,undefined);
 assert.equal(res.objectsCreated,1);
 assert.equal(res.objectsVerifiedInPrivateStorage,1);
 assert.equal(res.paymentEntitlementsGranted,0);
 assert.equal(res.trialRecordsChanged,0);
 assert.equal(res.ledgerRowsReconciled,0);
 assert.equal(res.recoveredSourceAuthenticityEstablished,false);
});
test('Storage conflict is acceptable ONLY when a private download matches exact hash',async()=>{
 const calls=[];
 const result=await uploadVerifiedObjects([item()],{
  env:config,fetchFn:storageMock({calls,status:409,stored:data})
 });
 assert.equal(result.existingMatchingObjects,1);
 assert.equal(result.objectsCreated,0);
 const other=Buffer.from('{"paid":true}');
 await assert.rejects(uploadVerifiedObjects([item()],{
  env:config,fetchFn:storageMock({status:409,stored:other})
 }),/hash mismatch/);
});
test('Storage upload success is NOT trusted when later download differs',async()=>{
 const corrupted=Buffer.from('{"paid":true}');
 await assert.rejects(uploadVerifiedObjects([item()],{
  env:config,fetchFn:storageMock({status:200,stored:corrupted})
 }),/hash mismatch/);
});
test('Storage failures and unexpected upstream errors fail without exposing private data',async()=>{
 const calls=[];
 await assert.rejects(uploadVerifiedObjects([item()],{
  env:config,fetchFn:storageMock({status:503,calls})
 }),/rejected/);
 assert.equal(calls.filter(x=>x.method==='GET').length,0);
 await assert.rejects(uploadVerifiedObjects([item()],{
  env:config,fetchFn:async()=>{throw Error('sensitive receipt contents');}
 }),e=>!e.message.includes('sensitive receipt contents'));
});
test('Invalid bytes, forged SHA or unsupported MIME are refused before any network call',async()=>{
 const calls=[];
 const bad=[
  {...item(),hash:'f'.repeat(64)},
  {...item(),key:'../../sensitive'},
  {...item(),mime:'image/gif'},
  {...item(),bytes:Buffer.from('wrong bytes')},
  {...item(),bytes:Buffer.alloc(0)}
 ];
 for(const entry of bad){
  await assert.rejects(uploadVerifiedObjects([entry],{
   env:config,fetchFn:storageMock({calls})
  }));
 }
 assert.equal(calls.length,0);
});
test('Duplicate identical objects deduplicate without losing hash verification',async()=>{
 const calls=[];
 const result=await uploadVerifiedObjects([item(),item()],{
  env:config,fetchFn:storageMock({calls})
 });
 assert.equal(result.objectsCreated,1);
 assert.equal(calls.length,2);
});
test('Dry-run CLI reads private files without requiring credentials or making network calls',async t=>{
 const dir=fixture(t);
 const inventoryFile=path.join(dir,'blob-list.json'),evidenceFile=path.join(dir,'recovered.json');
 fs.writeFileSync(inventoryFile,JSON.stringify(manifest()));
 fs.writeFileSync(evidenceFile,JSON.stringify(evidence()));
 const oldWrite=process.stdout.write;let printed='';
 process.stdout.write=x=>{printed+=String(x);return true};
 try{
  await cli(['--inventory',inventoryFile,'--evidence',evidenceFile,
   '--evidence-dir',dir,'--dry-run'],{});
 }finally{process.stdout.write=oldWrite}
 const output=JSON.parse(printed);
 assert.equal(output.objectsLocallyVerified,1);
 assert.equal(output.objectsUploaded,0);
 assert.equal(output.paymentEntitlementsGranted,0);
 assert.ok(!printed.includes(sourceKey));
 assert.ok(!printed.includes(digest));
 assert.ok(!printed.includes(config.SUPABASE_SECRET_KEY));
});
test('CLI cannot write without preflight files and an explicit --write flag',async()=>{
 await assert.rejects(cli(['--dry-run'],config),/Required/);
});


test('Only independently approved server operator can link verified evidence to ledger',async()=>{
 const calls=[];
 await assert.rejects(uploadVerifiedObjects([{...item(),sourceKey}],{
  env:{...config,SC_SUPER_ADMIN_UID:'e29aafda-2cc8-4e11-a587-c983dd3f9113'},
  recordEvidence:true,fetchFn:storageMock({calls})
 }),/approved/);
 assert.equal(calls.length,0);
});
test('Successful verified readback is required before append-only evidence linkage',async()=>{
 const requests=[];
 const uid='e29aafda-2cc8-4e11-a587-c983dd3f9113';
 const env={...config,SC_RECOVERY_LINK_APPROVED:'true',SC_SUPER_ADMIN_UID:uid};
 const payload={...item(),sourceKey};
 const mock=async(url,opts)=>{
  requests.push({url,opts});
  if(url.includes('/storage/v1/object/')){
   if(opts.method==='POST')return new Response(null,{status:200});
   if(opts.method==='GET')return new Response(data);
  }
  if(url.endsWith('/rest/v1/rpc/sc_recovery_link_evidence'))
   return new Response(JSON.stringify({status:'evidence_staged',
    accessGranted:false,paymentVerified:false}));
  throw Error('Unexpected URL');
 };
 const result=await uploadVerifiedObjects([payload],{env,recordEvidence:true,fetchFn:mock});
 assert.equal(result.ledgerEvidenceLinksRecorded,1);
 assert.equal(result.paymentEntitlementsGranted,0);
 assert.equal(result.trialRecordsChanged,0);
 assert.deepEqual(requests.map(x=>x.opts.method),['POST','GET','POST']);
 const rpc=JSON.parse(requests[2].opts.body);
 assert.deepEqual(rpc,{p_actor:uid,p_source_key:sourceKey,p_digest:digest,
  p_storage_path:item().key,p_size:data.length});
 assert.ok(!requests.some(x=>x.url.includes('/sc_paid_access')||
  x.url.includes('/sc_trials')));
});
test('Linking evidence does not trust a missing or forged source key',async()=>{
 const calls=[];
 const env={...config,SC_RECOVERY_LINK_APPROVED:'true',
  SC_SUPER_ADMIN_UID:'e29aafda-2cc8-4e11-a587-c983dd3f9113'};
 await assert.rejects(uploadVerifiedObjects([item()],{
  env,recordEvidence:true,fetchFn:storageMock({calls})
 }),/Source inventory identity/);
 assert.equal(calls.length,0);
});
test('Database response must explicitly confirm that no payment or access was granted',async()=>{
 const uid='e29aafda-2cc8-4e11-a587-c983dd3f9113';
 const env={...config,SC_RECOVERY_LINK_APPROVED:'true',SC_SUPER_ADMIN_UID:uid};
 for(const reply of [{status:'evidence_staged',accessGranted:true,paymentVerified:false},
  {status:'evidence_staged',accessGranted:false,paymentVerified:true},
  {status:'source_size_mismatch',accessGranted:false,paymentVerified:false}]){
  const mock=async(url,opts)=>{
   if(url.includes('/storage/v1/object/'))
    return opts.method==='GET'?new Response(data):new Response(null,{status:200});
   return new Response(JSON.stringify(reply));
  };
  await assert.rejects(uploadVerifiedObjects([{...item(),sourceKey}],{
   env,recordEvidence:true,fetchFn:mock
  }),/not verified/);
 }
});
test('Identical hashes from distinct source paths are verified once but linked independently',async()=>{
 const uid='e29aafda-2cc8-4e11-a587-c983dd3f9113';
 const env={...config,SC_RECOVERY_LINK_APPROVED:'true',SC_SUPER_ADMIN_UID:uid};
 const calls=[];
 const mock=async(url,opts)=>{
  calls.push({url,opts});
  if(url.includes('/storage/v1/object/'))
   return opts.method==='GET'?new Response(data):new Response(null,{status:200});
  return new Response(JSON.stringify({status:'already_recorded',
   accessGranted:false,paymentVerified:false}));
 };
 const result=await uploadVerifiedObjects([
  {...item(),sourceKey},{...item(),sourceKey:'cv2/members/member-other.json'}
 ],{env,recordEvidence:true,fetchFn:mock});
 assert.equal(result.objectsVerifiedInPrivateStorage,1);
 assert.equal(result.ledgerEvidenceLinksRecorded,2);
 assert.equal(calls.filter(x=>x.url.includes('/storage/v1/object/')).length,2);
 assert.equal(calls.filter(x=>x.url.includes('rpc/sc_recovery_link_evidence')).length,2);
});
test('Bad stored object hash blocks all evidence linkage writes',async()=>{
 const uid='e29aafda-2cc8-4e11-a587-c983dd3f9113';
 const env={...config,SC_RECOVERY_LINK_APPROVED:'true',SC_SUPER_ADMIN_UID:uid};
 const calls=[];
 await assert.rejects(uploadVerifiedObjects([{...item(),sourceKey}],{
  env,recordEvidence:true,
  fetchFn:async(url,opts)=>{
   calls.push(url);
   if(opts.method==='GET')return new Response(Buffer.from('wrong content'));
   return new Response(null,{status:200});
  }
 }),/hash mismatch/);
 assert.equal(calls.some(x=>x.includes('rpc/sc_recovery_link_evidence')),false);
});
