#!/usr/bin/env node
'use strict';
/**
 * Opt-in staging QA for actual Supabase authentication and Vercel private Blob.
 *
 * Read-only Auth probe:
 *   SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... node scripts/live-integration-smoke.cjs
 *
 * Optional ephemeral private storage write/read/delete:
 *   SC_QA_ENABLE_BLOB_PROBE=yes BLOB_READ_WRITE_TOKEN=... <same command>
 *
 * No account creation, phone claims, payment invoices, paid access or signal publishing.
 * Never commit keys or put token values into command output.
 */
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const core=require('../lib/candriva-core');
async function invalidAuth(){
 assert.equal(core.authConfig().ready,true,'Supabase public connection not configured');
 let failed=false;
 try{await core.identity({headers:{}})}catch(error){failed=error?.status===401}
 assert.ok(failed,'Missing authentication must return 401');
 failed=false;
 try{await core.identity({headers:{authorization:
  'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJuby1zdWNoLXVzZXIifQ.bm90LWEtcmVhbC1zaWduYXR1cmU'}})}
 catch(error){failed=error?.status===401}
 assert.ok(failed,'Supabase must reject forged JWTs');
 return {missingBearerDenied:true,forgedBearerDenied:true};
}
async function ephemeralBlob(){
 const {del}=require('@vercel/blob');
 assert.ok(process.env.BLOB_READ_WRITE_TOKEN,'Blob probe needs server-side token');
 const prefix='sc-qa-autocleanup/'+randomUUID()+'/';
 const jsonPath=prefix+'verify.json',filePath=prefix+'receipt.png';
 const touched=[];
 try{
  await core.write(jsonPath,{qa:true,count:617});touched.push(jsonPath);
  const found=await core.read(jsonPath);
  assert.equal(found?.count,617);
  const listed=await core.records(prefix,10);
  assert.ok(listed.some(v=>v?.qa&&v?.count===617),'Private Blob list returned no matching fixture');
  await assert.rejects(core.write(jsonPath,{overwrite:true}),error=>core.isConflict(error),
   'Immutable Blob overwrite unexpectedly succeeded');
  const bytes=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
  await core.write(filePath,bytes,'image/png');touched.push(filePath);
  assert.deepEqual(await core.readBinary(filePath),bytes);
  return {jsonReadWrite:true,privateList:true,immutableOverwrite:true,binaryReadWrite:true};
 }finally{
  let cleared=0;
  for(const p of touched.reverse()){
   try{await del(p);cleared++}
   catch(e){console.error('QA Blob cleanup failed for test file type',p.endsWith('.json')?'JSON':'PNG')}
  }
  if(cleared!==touched.length)process.exitCode=1;
  console.log('QA Blob cleanup:',cleared,'of',touched.length,'temporary objects');
 }
}
(async()=>{
 const auth=await invalidAuth();
 const blob=process.env.SC_QA_ENABLE_BLOB_PROBE==='yes'
  ?await ephemeralBlob()
  :{skipped:true,reason:'Explicit opt-in required to write temporary files'};
 console.log(JSON.stringify({result:process.exitCode===1?'PARTIAL':'PASS',auth,blob},null,2));
})().catch(error=>{console.error('LIVE_QA_FAILED',error.message);process.exitCode=1});
