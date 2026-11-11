#!/usr/bin/env node
'use strict';

/**
 * Migration-only, QUARANTINED inventory import. Not a user-facing API.
 *
 * Input: an explicitly complete READ-ONLY @vercel/blob list inventory exported
 * into a local JSON file. Never commit that file to GitHub.
 *
 * This does NOT read Blob bodies, approve payments, grant access, create trials,
 * verify ownership, or mark records reconciled. It is idempotent and append-only
 * for existing evidence rows: duplicates are ignored, never overwritten.
 *
 * Examples:
 * node scripts/stage-blob-inventory.cjs --manifest /private/blob-list.json --dry-run
 * SC_RECOVERY_IMPORT_APPROVED=true node scripts/stage-blob-inventory.cjs --manifest /private/blob-list.json --write
 *
 * Requires SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy service-role key)
 * only when --write is present. Do not print or commit these credentials.
 */

const fs=require('node:fs');
const path=require('node:path');
const MAX_OBJECTS=2000;
const SOURCE_KEY=/^[a-zA-Z0-9][a-zA-Z0-9_./=-]{2,511}$/;
const KIND_SET=new Set(['member','payment','review','grant','audit','signal','unknown']);
const validDate=value=>{
 if(value===null||value===undefined||value==='')return null;
 const date=new Date(value);
 if(!Number.isFinite(date.getTime())||date.getTime()<0||date.getTime()>Date.now()+86400000)
  throw Error('Invalid object timestamp');
 return date.toISOString();
};

function classify(sourceKey){
 const s=sourceKey.toLowerCase();
 if(/(^|\/)payments?\//.test(s))return 'payment';
 if(/(^|\/)decisions?\//.test(s)||/(^|\/)reviews?\//.test(s))return 'review';
 if(/(^|\/)grants?\//.test(s))return 'grant';
 if(/(^|\/)audits?\//.test(s))return 'audit';
 if(/(^|\/)(hourly|signals?)\//.test(s))return 'signal';
 if(/(^|\/)members?\//.test(s))return 'member';
 return 'unknown';
}
function normalizeInventory(input){
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw Error('Inventory must be a JSON object');
 if(input.source!=='vercel_blob_list'||input.complete!==true||
    !Array.isArray(input.blobs)||input.blobs.length>MAX_OBJECTS)
  throw Error('A complete Vercel Blob list inventory is required');
 if(input.blobs.length===0)
  throw Error('Refusing an empty inventory as proof of missing legacy records');
 const seen=new Set(),items=[];
 for(const blob of input.blobs){
  if(!blob||typeof blob!=='object'||Array.isArray(blob))
   throw Error('Invalid inventory item');
  const key=String(blob.pathname||'');
  if(!SOURCE_KEY.test(key)||key.includes('..')||key.includes('//')||
     key[0]==='/'||key.includes('\\'))
   throw Error('Unsafe Blob path');
  if(seen.has(key))throw Error('Inventory contains duplicate object paths');
  seen.add(key);
  const size=Number(blob.size);
  if(!Number.isSafeInteger(size)||size<0||size>10485760)
   throw Error('Unsafe Blob object size');
  const category=classify(key);
  if(!KIND_SET.has(category))throw Error('Unknown recovery classification');
  items.push({
   source_platform:'vercel_blob',
   source_key:key,
   item_kind:category,
   source_size_bytes:size,
   source_modified_at:validDate(blob.uploadedAt??blob.createdAt),
   retrieval_status:'inventory_only',
   review_status:'pending'
  });
 }
 return items;
}

function config(env){
 const base=String(env.SUPABASE_URL||'').replace(/\/+$/,'');
 const secret=String(env.SUPABASE_SECRET_KEY||'');
 const legacy=String(env.SUPABASE_SERVICE_ROLE_KEY||'');
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base))
  throw Error('Secure Supabase project URL is required for inventory import');
 if(/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(secret))
  return {url:base,key:secret,legacy:false};
 if(/^eyJ[A-Za-z0-9_.-]{80,}$/.test(legacy))
  return {url:base,key:legacy,legacy:true};
 throw Error('Server-only Supabase credential is missing');
}

async function importInventory(items,{env=process.env,fetchFn=globalThis.fetch}={}){
 if(env.SC_RECOVERY_IMPORT_APPROVED!=='true')
  throw Error('Explicit SC_RECOVERY_IMPORT_APPROVED=true is required');
 if(!Array.isArray(items)||items.length<1||items.length>MAX_OBJECTS)
  throw Error('Invalid inventory');
 const cfg=config(env);
 for(let i=0;i<items.length;i+=100){
  const group=items.slice(i,i+100);
  let result;
  try{
   const headers={
    apikey:cfg.key,'Content-Type':'application/json',
    Prefer:'resolution=ignore-duplicates,return=minimal'
   };
   if(cfg.legacy)headers.Authorization='Bearer '+cfg.key;
   result=await fetchFn(cfg.url+'/rest/v1/sc_legacy_recovery_items'+
    '?on_conflict=source_platform,source_key',{
     method:'POST',headers,body:JSON.stringify(group),
     signal:AbortSignal.timeout(10000),cache:'no-store'
    });
  }catch{
   throw Error('Recovery inventory import could not reach the private database');
  }
  if(!result?.ok)
   throw Error('Recovery inventory import rejected by private database');
 }
 // Imported rows stay inventory_only/pending regardless of what the source said.
 return {attempted:items.length,batches:Math.ceil(items.length/100),accessGrants:0};
}
function summary(items){
 const groups={member:0,payment:0,review:0,grant:0,audit:0,signal:0,unknown:0};
 for(const item of items)groups[item.item_kind]++;
 return {inventoryObjects:items.length,categories:groups,
  contentRecovered:0,accessGranted:0,
  warning:'Inventory metadata only. No payment, trial or entitlement has been verified.'};
}
async function cli(argv=process.argv.slice(2),env=process.env){
 const at=argv.indexOf('--manifest');
 const pathname=at>=0?argv[at+1]:null;
 const dry=argv.includes('--dry-run'),write=argv.includes('--write');
 if(!pathname||dry===write||!fs.existsSync(pathname))
  throw Error('Use --manifest <local JSON> with exactly one of --dry-run or --write');
 const raw=fs.readFileSync(path.resolve(pathname),'utf8');
 if(raw.length>2000000)throw Error('Inventory manifest exceeds size limit');
 const items=normalizeInventory(JSON.parse(raw));
 const report=summary(items);
 if(write)Object.assign(report,await importInventory(items,{env}));
 // No Blob paths, account identifiers, bearer keys or emails are printed.
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
if(require.main===module)cli().catch(e=>{
 process.stderr.write('Recovery inventory staging failed: '+String(e.message||'unknown')+'\n');
 process.exitCode=1;
});
module.exports={classify,normalizeInventory,config,importInventory,summary,cli};
