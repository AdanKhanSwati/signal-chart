'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {indexEvidenceCopies,validateOperator,cli}=require('../scripts/index-blob-evidence.cjs');
const bytes=Buffer.from('{"payment":"unverified","approved":false}');
const hash=crypto.createHash('sha256').update(bytes).digest('hex');
const operator='e29aafda-2cc8-4e11-a587-c983dd3f9113';
const sourceKey='cv5/payments/legacy-1.json';
const key='sha256/'+hash.slice(0,2)+'/'+hash+'.json';
const env={
 SUPABASE_URL:'https://qa-instance.supabase.co',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SC_RECOVERY_OPERATOR_UID:operator,
 SC_EVIDENCE_INDEX_APPROVED:'true'
};
const copy=()=>({sourceKey,key,hash,mime:'application/json',bytes:Buffer.from(bytes)});
const result={
 status:'indexed',sourceAuthenticityVerified:false,paymentVerified:false,
 accessGranted:false,inventoryStatusChanged:false
};
function mock({calls=[],stored=bytes,rpcResult=result,rpcStatus=200,getStatus=200}={}){
 return async(url,options={})=>{
  const route=new URL(url).pathname;
  calls.push({route,method:options.method,headers:options.headers,body:options.body});
  if(route.startsWith('/storage/v1/object/'))
   return new Response(getStatus===200?stored:null,{status:getStatus});
  if(route==='/rest/v1/rpc/sc_recovery_record_local_copy')
   return new Response(JSON.stringify(rpcResult),{status:rpcStatus});
  throw Error('Unexpected private network path');
 };
}
test('No writes or reads without independent operator authorization',async()=>{
 const calls=[];
 await assert.rejects(indexEvidenceCopies([copy()],{
  env:{...env,SC_EVIDENCE_INDEX_APPROVED:'false'},fetchFn:mock({calls})
 }),/Explicit/);
 assert.equal(calls.length,0);
 assert.throws(()=>validateOperator({...env,SC_RECOVERY_OPERATOR_UID:'someone'}));
 assert.throws(()=>validateOperator({...env,SUPABASE_SECRET_KEY:'',
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'}));
});
test('Private storage bytes are rehashed before any append-only index call',async()=>{
 const calls=[];
 const out=await indexEvidenceCopies([copy()],{env,fetchFn:mock({calls})});
 assert.equal(out.indexed,1);
 assert.equal(out.accessGranted,false);
 assert.equal(out.sourceAuthenticityVerified,false);
 assert.equal(out.paymentVerified,false);
 assert.equal(out.trialRecordsChanged,0);
 assert.equal(calls.length,2);
 assert.equal(calls[0].method,'GET');
 assert.equal(calls[1].method,'POST');
 assert.equal(calls[0].route,'/storage/v1/object/sc-legacy-evidence/'+key);
 assert.equal(calls[1].route,'/rest/v1/rpc/sc_recovery_record_local_copy');
 assert.deepEqual(JSON.parse(calls[1].body),{
  p_actor:operator,p_source_key:sourceKey,p_sha256:hash,
  p_object_name:key,p_byte_size:bytes.length,p_mime_type:'application/json'
 });
 assert.equal(calls[1].headers.apikey,env.SUPABASE_SECRET_KEY);
 assert.equal(calls[1].headers.Authorization,undefined);
});
test('Missing or modified storage bytes stop indexing before database writes',async()=>{
 for(const args of [{getStatus:404},{stored:Buffer.from('{"approved":true}')}]){
  const calls=[];
  await assert.rejects(indexEvidenceCopies([copy()],{
   env,fetchFn:mock({...args,calls})
  }));
  assert.equal(calls.filter(x=>x.method==='POST').length,0);
 }
});
test('Reject unexpected privilege claims even when RPC says indexed',async()=>{
 for(const key of ['sourceAuthenticityVerified','paymentVerified',
  'accessGranted','inventoryStatusChanged']){
  const calls=[];
  await assert.rejects(indexEvidenceCopies([copy()],{
   env,fetchFn:mock({calls,rpcResult:{...result,[key]:true}})
  }),/entitlement authority/);
 }
});
test('Idempotent already_indexed response never changes access state',async()=>{
 const out=await indexEvidenceCopies([copy()],{
  env,fetchFn:mock({rpcResult:{...result,status:'already_indexed'}})
 });
 assert.equal(out.alreadyIndexed,1);
 assert.equal(out.indexed,0);
 assert.equal(out.accessGranted,false);
});
test('Source mismatch, missing storage metadata and RPC errors fail closed',async()=>{
 for(const status of ['source_not_in_inventory','private_object_not_verified','unexpected']){
  await assert.rejects(indexEvidenceCopies([copy()],{
   env,fetchFn:mock({rpcResult:{...result,status}})
  }));
 }
 await assert.rejects(indexEvidenceCopies([copy()],{
  env,fetchFn:mock({rpcStatus:503})
 }));
});
test('Forged content-addressed names, invalid bytes and duplicate source keys fail before network',async()=>{
 const bad=[
  {...copy(),hash:'0'.repeat(64)},
  {...copy(),key:'sha256/xx/not-a-hash.json'},
  {...copy(),mime:'text/html'},
  {...copy(),bytes:Buffer.from('tampered')}
 ];
 const calls=[];
 for(const item of bad)await assert.rejects(indexEvidenceCopies([item],{
  env,fetchFn:mock({calls})
 }));
 await assert.rejects(indexEvidenceCopies([copy(),copy()],{
  env,fetchFn:mock({calls})
 }),/Duplicate/);
 assert.equal(calls.length,0);
});
test('No arbitrary upstream error or source data leaks through CLI output',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sc-index-private-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'receipt.json'),bytes);
 const inv=path.join(dir,'inventory.json'),evi=path.join(dir,'evidence.json');
 fs.writeFileSync(inv,JSON.stringify({
  source:'vercel_blob_list',complete:true,
  blobs:[{pathname:sourceKey,size:bytes.length,uploadedAt:'2026-11-01T00:00:00Z'}]
 }));
 fs.writeFileSync(evi,JSON.stringify({
  source:'vercel_blob_recovery',objects:[{
   pathname:sourceKey,file:'receipt.json',sha256:hash
  }]
 }));
 let output='';const old=process.stdout.write;
 process.stdout.write=x=>{output+=String(x);return true};
 try{
  await cli(['--inventory',inv,'--evidence',evi,
   '--evidence-dir',dir,'--dry-run'],{});
 }finally{process.stdout.write=old}
 const report=JSON.parse(output);
 assert.equal(report.locallyVerified,1);
 assert.equal(report.privateCopiesIndexed,0);
 assert.equal(report.accessGranted,false);
 assert.ok(!output.includes(sourceKey));
 assert.ok(!output.includes(hash));
 await assert.rejects(indexEvidenceCopies([copy()],{
  env,fetchFn:async()=>{throw Error('private receipt data leaked')}
 }),e=>!e.message.includes('private receipt'));
});
