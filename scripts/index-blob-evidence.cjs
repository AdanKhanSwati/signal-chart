#!/usr/bin/env node
'use strict';

/**
 * Operator-only, explicitly approved indexing of recovered historical evidence.
 * Requires the COMPLETE private Vercel Blob listing, local recovered bytes,
 * and previously uploaded private Supabase objects. Reads each object back and
 * checks SHA-256 before asking the restricted RPC to append an audit reference.
 *
 * Does not establish source authenticity, update trial/paid access, approve
 * payments, mark items reconciled or create missing inventory rows.
 */
const crypto=require('node:crypto');
const {parseManifest,normalizeEvidence}=require('./verify-blob-evidence.cjs');
const {verifyRecoveredFiles}=require('./upload-blob-evidence.cjs');
const {config}=require('./stage-blob-inventory.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES=3145728;
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const privateHeaders=cfg=>({
 apikey:cfg.key,...(cfg.legacy?{Authorization:'Bearer '+cfg.key}:{})
});
async function request(fetchFn,url,options){
 try{
  return await fetchFn(url,{
   ...options,signal:AbortSignal.timeout(12000),cache:'no-store'
  });
 }catch{throw Error('Private evidence index operation could not reach Supabase')}
}
function validateOperator(env){
 if(env.SC_EVIDENCE_INDEX_APPROVED!=='true')
  throw Error('Explicit SC_EVIDENCE_INDEX_APPROVED=true is required');
 if(!UUID.test(env.SC_RECOVERY_OPERATOR_UID||''))
  throw Error('Verified recovery operator UUID is required');
 return {cfg:config(env),actor:env.SC_RECOVERY_OPERATOR_UID};
}
async function indexEvidenceCopies(items,{env=process.env,fetchFn=globalThis.fetch}={}){
 const {cfg,actor}=validateOperator(env);
 if(!Array.isArray(items)||items.length<1||items.length>250)
  throw Error('Invalid bounded evidence copy list');
 const keys=new Set();
 for(const item of items){
  if(typeof item?.sourceKey!=='string'||!item.sourceKey||
     !Buffer.isBuffer(item.bytes)||item.bytes.length<1||item.bytes.length>MAX_BYTES||
     !/^[a-f0-9]{64}$/.test(item.hash||'')||
     sha256(item.bytes)!==item.hash||
     !/^sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.(?:json|png|jpg)$/.test(item.key||'')||
     item.key!=='sha256/'+item.hash.slice(0,2)+'/'+item.hash+'.'+
      ({'application/json':'json','image/png':'png','image/jpeg':'jpg'}[item.mime]||'invalid'))
   throw Error('Invalid private evidence copy');
  if(keys.has(item.sourceKey))throw Error('Duplicate source key in evidence manifest');
  keys.add(item.sourceKey);
 }
 let indexed=0,alreadyIndexed=0;
 for(const item of items){
  const endpoint=cfg.url+'/storage/v1/object/sc-legacy-evidence/'+item.key;
  const stored=await request(fetchFn,endpoint,{
   method:'GET',headers:privateHeaders(cfg)
  });
  if(!stored?.ok)throw Error('Quarantined evidence is missing from private storage');
  let bytes;
  try{
   const ab=await stored.arrayBuffer();
   if(ab.byteLength>MAX_BYTES)throw Error('Oversized object');
   bytes=Buffer.from(ab);
  }catch{throw Error('Private evidence bytes cannot be inspected')}
  if(bytes.length!==item.bytes.length||sha256(bytes)!==item.hash)
   throw Error('Quarantined evidence does not match locally verified bytes');
  const response=await request(fetchFn,cfg.url+'/rest/v1/rpc/sc_recovery_record_local_copy',{
   method:'POST',headers:{
    ...privateHeaders(cfg),'Content-Type':'application/json'
   },
   body:JSON.stringify({
    p_actor:actor,p_source_key:item.sourceKey,
    p_sha256:item.hash,p_object_name:item.key,
    p_byte_size:item.bytes.length,p_mime_type:item.mime
   })
  });
  if(!response?.ok)throw Error('Private recovery copy index RPC was rejected');
  let result;
  try{result=await response.json()}catch{throw Error('Invalid private index RPC response')}
  if(result?.sourceAuthenticityVerified!==false||
     result?.paymentVerified!==false||result?.accessGranted!==false||
     result?.inventoryStatusChanged!==false)
   throw Error('Private evidence index unexpectedly claimed entitlement authority');
  if(result.status==='indexed')indexed++;
  else if(result.status==='already_indexed')alreadyIndexed++;
  else if(result.status==='source_not_in_inventory')
   throw Error('Evidence has no matching historical inventory record');
  else if(result.status==='private_object_not_verified')
   throw Error('Private evidence metadata is not verified');
  else throw Error('Unexpected private evidence index response');
 }
 return {
  indexed,alreadyIndexed,
  sourceAuthenticityVerified:false,paymentVerified:false,
  accessGranted:false,trialRecordsChanged:0,
  warning:'Local copy linkage only; historical source, ownership and payment claims remain unverified.'
 };
}
async function cli(args=process.argv.slice(2),env=process.env){
 const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
 const inventoryPath=option('--inventory'),evidencePath=option('--evidence'),
  evidenceDir=option('--evidence-dir');
 const dry=args.includes('--dry-run'),write=args.includes('--write');
 if(!inventoryPath||!evidencePath||!evidenceDir||dry===write)
  throw Error('Use --inventory --evidence --evidence-dir and exactly one of --dry-run/--write');
 const inventory=parseManifest(inventoryPath),evidence=parseManifest(evidencePath);
 const {objects,preflightSummary}=verifyRecoveredFiles(inventory,evidence,evidenceDir);
 const entries=normalizeEvidence(evidence,inventory);
 const copies=objects.map((item,i)=>({...item,sourceKey:entries[i].sourceKey}));
 const result=write?await indexEvidenceCopies(copies,{env}):{
  locallyVerified:preflightSummary.checked,
  privateCopiesIndexed:0,accessGranted:false,
  warning:'Dry-run only. No private database or storage changes.'
 };
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(require.main===module)cli().catch(()=>{
 process.stderr.write('Private evidence indexing failed; inspect local records and private storage without exposing identifiers.\n');
 process.exitCode=1;
});
module.exports={validateOperator,indexEvidenceCopies,cli};
