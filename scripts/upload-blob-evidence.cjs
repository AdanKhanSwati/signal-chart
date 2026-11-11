#!/usr/bin/env node
'use strict';

/**
 * Private, operator-approved one-time transfer of locally recovered Blob
 * evidence to the Supabase Storage quarantine bucket. NOT a user-facing API.
 *
 * Requires a complete, read-only historical inventory, a separate evidence
 * manifest, local verified bytes outside Git, and a server-only Supabase key.
 * Every object is uploaded without upsert, then fetched back and rehashed.
 *
 * Does not read Vercel Blob directly, authenticate source provenance, alter
 * the recovery metadata ledger, approve a payment, mark review complete,
 * update sc_paid_access, change trial records or issue premium access.
 */

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {
 parseManifest,normalizeEvidence,verifyEvidence,safeRelative,mediaType
}=require('./verify-blob-evidence.cjs');
const {config}=require('./stage-blob-inventory.cjs');
const BUCKET='sc-legacy-evidence';
const SHA=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILES=250;
const MAX_TOTAL_BYTES=40*1024*1024;
const MAX_FILE_BYTES=3145728;
const MIME_EXT={
 'application/json':'json','image/png':'png','image/jpeg':'jpg'
};
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

function objectPath(digestHex,mime){
 if(!SHA.test(digestHex)||!Object.hasOwn(MIME_EXT,mime))
  throw Error('Invalid content-addressed evidence object');
 return 'sha256/'+digestHex.slice(0,2)+'/'+digestHex+'.'+MIME_EXT[mime];
}

function verifyRecoveredFiles(inventory,evidence,evidenceDir){
 const preflight=verifyEvidence(inventory,evidence,{evidenceDir});
 const validated=normalizeEvidence(evidence,inventory);
 if(validated.length>MAX_FILES||preflight.summary.bytesChecked>MAX_TOTAL_BYTES)
  throw Error('Recovery upload exceeds guarded batch budget');
 const root=fs.realpathSync(evidenceDir);
 const objects=validated.map((entry,i)=>{
  if(!safeRelative(entry.file))throw Error('Unsafe private local path');
  const candidate=path.resolve(root,entry.file);
  if(!candidate.startsWith(root+path.sep))throw Error('Private evidence path is outside directory');
  const stat=fs.lstatSync(candidate);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>MAX_FILE_BYTES)
   throw Error('Private evidence file changed after validation');
  if(!fs.realpathSync(candidate).startsWith(root+path.sep))
   throw Error('Private evidence symlink detected');
  const bytes=fs.readFileSync(candidate);
  const expected=preflight.objects[i];
  if(bytes.length!==stat.size||bytes.length!==expected.source_size_bytes||
     digest(bytes)!==expected.content_sha256||
     mediaType(bytes,entry.sourceKey)!==expected.mime_type)
   throw Error('Private recovered evidence changed after verification');
  return {sourceKey:entry.sourceKey,key:objectPath(expected.content_sha256,expected.mime_type),
   hash:expected.content_sha256,mime:expected.mime_type,bytes};
 });
 return {objects,preflightSummary:preflight.summary};
}

function guardedConfig(env){
 if(env.SC_EVIDENCE_UPLOAD_APPROVED!=='true')
  throw Error('Explicit SC_EVIDENCE_UPLOAD_APPROVED=true is required for upload');
 const result=config(env);
 // No upload from a frontend. Credentials stay only inside this Node process.
 return result;
}

function privateHeaders(cfg,extra={}){
 return {
  apikey:cfg.key,
  ...(cfg.legacy?{Authorization:'Bearer '+cfg.key}:{}),
  ...extra
 };
}
async function call(fetchFn,url,options){
 try{
  return await fetchFn(url,{...options,signal:AbortSignal.timeout(12000),cache:'no-store'});
 }catch{
  throw Error('Private evidence storage request failed');
 }
}

async function uploadVerifiedObjects(items,{
 env=process.env,fetchFn=globalThis.fetch,recordEvidence=false
}={}){
 const cfg=guardedConfig(env);
 if(!Array.isArray(items)||!items.length||items.length>MAX_FILES)
  throw Error('No bounded private evidence to upload');
 const unique=new Set(),verified=new Set();
 let total=0,created=0,alreadyPresent=0,linked=0;
 const actor=String(env.SC_SUPER_ADMIN_UID||'').toLowerCase();
 if(recordEvidence&&(env.SC_RECOVERY_LINK_APPROVED!=='true'||!UUID.test(actor)))
  throw Error('Evidence linkage needs an independently approved verified operator');
 for(const item of items){
  if(!Buffer.isBuffer(item?.bytes)||item.bytes.length<1||item.bytes.length>MAX_FILE_BYTES||
     !SHA.test(item.hash||'')||digest(item.bytes)!==item.hash||
     !Object.hasOwn(MIME_EXT,item.mime)||
     item.key!==objectPath(item.hash,item.mime)||
     !/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.(?:json|png|jpg)$/.test(item.key))
   throw Error('Invalid evidence bytes or object identity');
  total+=item.bytes.length;
  if(total>MAX_TOTAL_BYTES)throw Error('Evidence upload exceeds byte budget');
  if(recordEvidence&&(!item.sourceKey||typeof item.sourceKey!=='string'||
     item.sourceKey.length<3||item.sourceKey.length>512))
   throw Error('Source inventory identity is required for evidence linkage');
  if(unique.has(item.key))continue; // identical content deduplicates safely.
  unique.add(item.key);
 }
 for(const item of items){
  if(unique.has(item.key)===false)continue;
  unique.delete(item.key);
  const endpoint=cfg.url+'/storage/v1/object/'+BUCKET+'/'+item.key;
  const response=await call(fetchFn,endpoint,{
   method:'POST',
   headers:privateHeaders(cfg,{
    'Content-Type':item.mime,'Cache-Control':'no-store','x-upsert':'false'
   }),body:item.bytes
  });
  if(response?.ok)created++;
  else if(response?.status===400||response?.status===409)
   alreadyPresent++; // Never treat conflict alone as proof that bytes match.
  else throw Error('Private evidence storage rejected a recovered object');
  // Verify actual stored bytes with a separately authorized READ. Any
  // mismatch or empty retrieval fails the entire run; never mark verified.
  const check=await call(fetchFn,endpoint,{
   method:'GET',headers:privateHeaders(cfg,{'Cache-Control':'no-store'})
  });
  if(!check?.ok)throw Error('Cannot verify uploaded evidence from private storage');
  let bytes;
  try{
   const payload=await check.arrayBuffer();
   if(payload.byteLength>MAX_FILE_BYTES)throw Error('Too large');
   bytes=Buffer.from(payload);
  }catch{
   throw Error('Cannot inspect private stored evidence');
  }
  if(bytes.length!==item.bytes.length||digest(bytes)!==item.hash)
   throw Error('Private storage evidence hash mismatch; upload is unverified');
  verified.add(item.key);
 }
 if(recordEvidence){
  // Each distinct source inventory entry is linked separately, even when
  // multiple objects have identical content-addressed private bytes.
  for(const item of items){
   if(!verified.has(item.key))throw Error('Unverified private evidence cannot be linked');
   const response=await call(fetchFn,cfg.url+'/rest/v1/rpc/sc_recovery_link_evidence',{
    method:'POST',headers:privateHeaders(cfg,{'Content-Type':'application/json'}),
    body:JSON.stringify({p_actor:actor,p_source_key:item.sourceKey,
     p_digest:item.hash,p_storage_path:item.key,p_size:item.bytes.length})
   });
   if(!response?.ok)throw Error('Private evidence linkage was rejected by database');
   let result;
   try{result=await response.json()}catch{throw Error('Private evidence linkage response invalid')}
   if(!['evidence_staged','already_recorded'].includes(result?.status)||
      result?.accessGranted!==false||result?.paymentVerified!==false)
    throw Error('Evidence staging was not verified; no entitlement changes allowed');
   linked++;
  }
 }
 return {
  objectsVerifiedInPrivateStorage:created+alreadyPresent,
  objectsCreated:created,
  existingMatchingObjects:alreadyPresent,
  ledgerEvidenceLinksRecorded:linked,
  recoveredSourceAuthenticityEstablished:false,
  paymentEntitlementsGranted:0,
  trialRecordsChanged:0,
  ledgerRowsReconciled:0,
  warning:'Evidence is private and byte-verified, but source provenance and all payment/account claims require separate human review.'
 };
}

async function cli(argv=process.argv.slice(2),env=process.env){
 const opt=name=>{const at=argv.indexOf(name);return at<0?null:argv[at+1]};
 const inventoryPath=opt('--inventory'),evidencePath=opt('--evidence'),
  evidenceDir=opt('--evidence-dir');
 const dry=argv.includes('--dry-run'),write=argv.includes('--write');
 const recordEvidence=argv.includes('--link-ledger');
 if(recordEvidence&&!write)throw Error('Ledger linkage requires --write');
 if(!inventoryPath||!evidencePath||!evidenceDir||dry===write)
  throw Error('Required: --inventory --evidence --evidence-dir and exactly one of --dry-run/--write');
 const {objects,preflightSummary}=verifyRecoveredFiles(
  parseManifest(inventoryPath),parseManifest(evidencePath),evidenceDir);
 const result=write?await uploadVerifiedObjects(objects,{env,recordEvidence}):
  {objectsLocallyVerified:preflightSummary.checked,
   bytesLocallyHashed:preflightSummary.bytesChecked,objectsUploaded:0,
   paymentEntitlementsGranted:0,
   warning:'Dry run only. No cloud data or access records changed.'};
 // Never echo sensitive source paths, private evidence data, credentials or
 // content-addressed object keys to stdout.
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(require.main===module)cli().catch(()=>{
 process.stderr.write('Private evidence transfer failed. Review local inventory and storage access without sharing secrets.\n');
 process.exitCode=1;
});
module.exports={objectPath,verifyRecoveredFiles,uploadVerifiedObjects,guardedConfig,cli};
