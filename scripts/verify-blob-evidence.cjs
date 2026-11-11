#!/usr/bin/env node
'use strict';

/**
 * Offline, read-only verification of recovered legacy Vercel Blob copies.
 *
 * Checks local bytes against a COMPLETE source inventory and optional
 * independently supplied digest. Does not authenticate the original source,
 * upload files, update Supabase, grant trials, approve payments, or clear holds.
 * A private report can be written outside the Git checkout for later review.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {normalizeInventory}=require('./stage-blob-inventory.cjs');
const MAX_EVIDENCE=250;
const MAX_FILE_BYTES=3145728; // Matches private sc-legacy-evidence bucket.
const MAX_MANIFEST_BYTES=2_000_000;
const SHA256=/^[a-f0-9]{64}$/;
const SAFE_LOCAL=/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,240}$/;
const PNG=Buffer.from('89504e470d0a1a0a','hex');

function parseManifest(file){
 const stats=fs.statSync(file);
 if(!stats.isFile()||stats.size>MAX_MANIFEST_BYTES)
  throw Error('Invalid or oversized private manifest');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
function safeRelative(name){
 return typeof name==='string'&&SAFE_LOCAL.test(name)&&
  !name.includes('//')&&!name.split('/').includes('..')&&
  !name.split('/').includes('.')&&!path.posix.isAbsolute(name);
}
function mediaType(bytes,sourceKey){
 const lower=sourceKey.toLowerCase();
 if(lower.endsWith('.json')){
  try{JSON.parse(bytes.toString('utf8'));return 'application/json'}
  catch{throw Error('Recovered JSON is invalid')}
 }
 if(lower.endsWith('.png')&&bytes.length>=PNG.length&&
    bytes.subarray(0,PNG.length).equals(PNG))return 'image/png';
 if(/\.jpe?g$/.test(lower)&&bytes.length>=4&&
    bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&
    bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217)
  return 'image/jpeg';
 throw Error('Recovered object is not an approved evidence format');
}
function normalizeEvidence(manifest,inventory){
 const inventoryRows=normalizeInventory(inventory);
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||
    manifest.source!=='vercel_blob_recovery'||!Array.isArray(manifest.objects)||
    manifest.objects.length===0||manifest.objects.length>MAX_EVIDENCE)
  throw Error('Invalid recovered evidence manifest');
 const inventoryByKey=new Map(inventoryRows.map(row=>[row.source_key,row]));
 const seen=new Set();
 return manifest.objects.map(object=>{
  if(!object||typeof object!=='object'||Array.isArray(object)||
     typeof object.pathname!=='string'||!inventoryByKey.has(object.pathname))
   throw Error('Evidence object not in verified source inventory');
  if(seen.has(object.pathname))throw Error('Duplicate evidence source key');
  seen.add(object.pathname);
  if(!safeRelative(object.file))throw Error('Unsafe local evidence file path');
  if(object.sha256!==undefined&&(!SHA256.test(object.sha256)))
   throw Error('Invalid expected digest');
  return {sourceKey:object.pathname,file:object.file,
   expectedSha256:object.sha256||null,inventory:inventoryByKey.get(object.pathname)};
 });
}
function verifyEvidence(inventory,evidence,{evidenceDir}={}){
 if(typeof evidenceDir!=='string'||!path.isAbsolute(evidenceDir))
  throw Error('Absolute private evidence directory is required');
 const root=fs.realpathSync(evidenceDir);
 if(!fs.statSync(root).isDirectory())throw Error('Evidence root is not a directory');
 const entries=normalizeEvidence(evidence,inventory);
 const verified=[];
 let bytesTotal=0;
 for(const entry of entries){
  const candidate=path.resolve(root,entry.file);
  if(!candidate.startsWith(root+path.sep))
   throw Error('Evidence path escapes private directory');
  const stat=fs.lstatSync(candidate);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_FILE_BYTES||stat.size<1)
   throw Error('Evidence file is not a permitted regular file');
  const real=fs.realpathSync(candidate);
  if(!real.startsWith(root+path.sep))
   throw Error('Evidence file resolves outside private directory');
  if(stat.size!==entry.inventory.source_size_bytes)
   throw Error('Evidence bytes do not match source inventory size');
  const data=fs.readFileSync(candidate);
  if(data.length!==stat.size)throw Error('Evidence file changed during verification');
  const digest=crypto.createHash('sha256').update(data).digest('hex');
  if(entry.expectedSha256&&entry.expectedSha256!==digest)
   throw Error('Evidence digest does not match independently recorded value');
  const mimeType=mediaType(data,entry.sourceKey);
  bytesTotal+=data.length;
  verified.push({source_key:entry.sourceKey,source_platform:'vercel_blob',
   source_size_bytes:data.length,content_sha256:digest,mime_type:mimeType,
   verification_level:entry.expectedSha256?'local_digest_matches_manifest':'local_bytes_hashed',
   source_authenticity_verified:false,review_status:'pending',
   access_granted:false});
 }
 return {objects:verified,summary:{checked:verified.length,bytesChecked:bytesTotal,
  locallyHashed:verified.length,sourceAuthenticityVerified:0,
  manuallyReconciled:0,entitlementsGranted:0,
  note:'Local integrity only. Original Blob provenance, payment and account ownership remain unverified.'}};
}
function writePrivateReport(output,result){
 if(typeof output!=='string'||!path.isAbsolute(output))
  throw Error('Private output must be an absolute path');
 const dir=fs.realpathSync(path.dirname(output));
 const cwd=fs.realpathSync(process.cwd());
 if(dir===cwd||dir.startsWith(cwd+path.sep))
  throw Error('Private report must be outside the working repository');
 const descriptor=fs.openSync(output,'wx',0o600);
 try{fs.writeFileSync(descriptor,JSON.stringify({source:'local_recovery_preflight',
  ...result},null,2)+'\n')}
 finally{fs.closeSync(descriptor)}
}
function cli(args=process.argv.slice(2)){
 const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
 const inventoryFile=option('--inventory'),evidenceFile=option('--evidence');
 const evidenceDir=option('--evidence-dir'),output=option('--output');
 if(!inventoryFile||!evidenceFile||!evidenceDir||!args.includes('--dry-run')||
    (output&&!args.includes('--write-private-report'))||
    (args.includes('--write-private-report')&&!output))
  throw Error('Use --inventory --evidence --evidence-dir --dry-run [--write-private-report --output /private/report.json]');
 const result=verifyEvidence(parseManifest(inventoryFile),parseManifest(evidenceFile),{evidenceDir});
 if(output)writePrivateReport(output,result);
 process.stdout.write(JSON.stringify(result.summary,null,2)+'\n');
}
if(require.main===module){
 try{cli()}catch{
  // Never include private paths, source object identifiers or source data in CLI errors.
  process.stderr.write('Evidence preflight failed; inspect private manifests and local files offline.\n');
  process.exitCode=1;
 }
}
module.exports={parseManifest,safeRelative,mediaType,normalizeEvidence,verifyEvidence,writePrivateReport,cli};
