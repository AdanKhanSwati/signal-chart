'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 classify,normalizeInventory,importInventory,summary
}=require('../scripts/stage-blob-inventory.cjs');
const blob=(pathname,size=512)=>({pathname,size,uploadedAt:'2026-11-01T00:00:00Z'});
const inventory=blobs=>({source:'vercel_blob_list',complete:true,blobs});
const secretEnv={
 SUPABASE_URL:'https://qa-instance.supabase.co',
 SUPABASE_SECRET_KEY:'sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
 SC_RECOVERY_IMPORT_APPROVED:'true'
};
const success=()=>({ok:true,status:201});
test('Classifies legacy inventory paths without inspecting sensitive Blob body contents',()=>{
 assert.equal(classify('audit/log.json'),'audit');
 assert.equal(classify('cv2/members/00000000-aaaa-bbbb-cccc-dddddddddddd.json'),'member');
 assert.equal(classify('cv5/payments/reference.json'),'payment');
 assert.equal(classify('cv5/reviews/ref.json'),'review');
 assert.equal(classify('cv5/grants/user/grant.json'),'grant');
 assert.equal(classify('sc5/hourly/fx.json'),'signal');
 assert.equal(classify('cv6/private/other.json'),'unknown');
});
test('Converts complete manifest into quarantined rows without entitlements',()=>{
 const src=inventory([blob('cv2/members/example-uuid.json'),blob('cv5/payments/pay-1.json')]);
 const items=normalizeInventory(src);
 assert.equal(items.length,2);
 assert.equal(items[0].source_platform,'vercel_blob');
 assert.equal(items[0].item_kind,'member');
 assert.equal(items[1].item_kind,'payment');
 assert.equal(items[0].review_status,'pending');
 assert.equal(items[0].retrieval_status,'inventory_only');
 assert.ok(!('content_sha256' in items[0]));
 assert.ok(!('approved' in items[1]));
 assert.ok(!('paidUntil' in items[1]));
 assert.deepEqual(summary(items),{
  inventoryObjects:2,
  categories:{member:1,payment:1,review:0,grant:0,audit:0,signal:0,unknown:0},
  contentRecovered:0,accessGranted:0,
  warning:'Inventory metadata only. No payment, trial or entitlement has been verified.'
 });
});
test('Incomplete or empty manifests are rejected rather than treated as complete recovery',()=>{
 const b=blob('audit/log.json');
 for(const doc of [
  {blobs:[b]}, {source:'vercel_blob_list',complete:false,blobs:[b]},
  {source:'untrusted',complete:true,blobs:[b]},inventory([])
 ])assert.throws(()=>normalizeInventory(doc),/complete|empty/i);
});
test('Duplicate and unsafe object paths fail closed',()=>{
 for(const bad of [
  'cv5/../secrets.json','/absolute/private.json','cv5//payments/p.json',
  'cv5\\payments\\p.json','a<script>.json','x'.repeat(600)
 ])assert.throws(()=>normalizeInventory(inventory([blob(bad)])),/Unsafe/);
 assert.throws(()=>normalizeInventory(inventory([
  blob('audit/log.json'),blob('audit/log.json')
 ])),/duplicate/);
});
test('Invalid object sizes and object timestamps fail validation',()=>{
 assert.throws(()=>normalizeInventory(inventory([blob('audit/one.json',-1)])),/size/);
 assert.throws(()=>normalizeInventory(inventory([blob('audit/one.json',10485761)])),/size/);
 assert.throws(()=>normalizeInventory(inventory([{...blob('audit/one.json'),uploadedAt:'not-a-date'}])),/timestamp/);
});
test('Refuses to write without a second independent environment approval',async()=>{
 const items=normalizeInventory(inventory([blob('audit/log.json')]));
 let called=false;
 await assert.rejects(importInventory(items,{env:{...secretEnv,SC_RECOVERY_IMPORT_APPROVED:'false'},
  fetchFn:async()=>{called=true;return success()}}),/Explicit/);
 assert.equal(called,false);
});
test('Server-only secret is passed in apikey header with no Authorization on modern keys',async()=>{
 const items=normalizeInventory(inventory([blob('members/member.json')]));
 const requests=[];
 const outcome=await importInventory(items,{env:secretEnv,fetchFn:async(url,options)=>{
  requests.push({url,options});return success();
 }});
 assert.deepEqual(outcome,{attempted:1,batches:1,accessGrants:0});
 assert.equal(requests.length,1);
 assert.match(requests[0].url,/sc_legacy_recovery_items\?on_conflict=source_platform,source_key$/);
 assert.equal(requests[0].options.headers.apikey,secretEnv.SUPABASE_SECRET_KEY);
 assert.equal(requests[0].options.headers.Authorization,undefined);
 assert.match(requests[0].options.headers.Prefer,/ignore-duplicates,return=minimal/);
 const payload=JSON.parse(requests[0].options.body);
 assert.equal(payload[0].retrieval_status,'inventory_only');
 assert.equal(payload[0].review_status,'pending');
});
test('Legacy service-role credential includes Authorization only on server',async()=>{
 const items=normalizeInventory(inventory([blob('audit/log.json')]));
 const legacy='eyJ'+('x'.repeat(95));
 const headers=[];
 await importInventory(items,{env:{
  SUPABASE_URL:secretEnv.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:legacy,
  SC_RECOVERY_IMPORT_APPROVED:'true'
 },fetchFn:async(url,opts)=>{headers.push(opts.headers);return success()}});
 assert.equal(headers[0].apikey,legacy);
 assert.equal(headers[0].Authorization,'Bearer '+legacy);
});
test('Large inventories are imported in bounded 100-row batches with ignore duplicates',async()=>{
 const blobs=Array.from({length:212},(_,i)=>blob('audit/object-'+i+'.json'));
 const items=normalizeInventory(inventory(blobs));
 const counts=[];
 const result=await importInventory(items,{env:secretEnv,fetchFn:async(url,opts)=>{
  counts.push(JSON.parse(opts.body).length);return success();
 }});
 assert.deepEqual(counts,[100,100,12]);
 assert.equal(result.attempted,212);
 assert.equal(result.batches,3);
});
test('Provider errors fail safely without printing raw upstream or secrets',async()=>{
 const items=normalizeInventory(inventory([blob('audit/log.json')]));
 await assert.rejects(importInventory(items,{env:secretEnv,fetchFn:async()=>({ok:false,status:500})}),
  e=>!e.message.includes('sb_secret_')&&!e.message.includes('audit/log.json'));
 await assert.rejects(importInventory(items,{env:secretEnv,fetchFn:async()=>{throw Error('sensitive provider details')}}),
  e=>!e.message.includes('sensitive provider details'));
});
