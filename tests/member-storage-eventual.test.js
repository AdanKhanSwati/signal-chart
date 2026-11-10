'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const blobId=require.resolve('@vercel/blob'),previous=require.cache[blobId].exports;
const coreId=require.resolve('../lib/candriva-core');
const existingToken=process.env.BLOB_READ_WRITE_TOKEN;
const saved=new Map();
let readsAfterWriteToMiss=0;
let dropAllReads=false;
const reading={
 get:async pathname=>{
  if(dropAllReads)return null;
  if(saved.has(pathname)&&readsAfterWriteToMiss>0){readsAfterWriteToMiss--;return null}
  if(!saved.has(pathname))return null;
  return {stream:new ReadableStream({start(c){c.enqueue(Buffer.from(saved.get(pathname)));c.close()}})};
 },
 put:async(pathname,body,options)=>{
  assert.equal(options.access,'private');
  assert.equal(options.allowOverwrite,false);
  if(saved.has(pathname))throw Error('BlobAlreadyExistsError');
  saved.set(pathname,String(body));
  return {pathname};
 },
 list:async({prefix})=>({
  blobs:[...saved.keys()].filter(p=>p.startsWith(prefix)).map(pathname=>({pathname})),
  hasMore:false,cursor:null
 })
};
require.cache[blobId].exports={...previous,...reading};
delete require.cache[coreId];
process.env.BLOB_READ_WRITE_TOKEN='synthetic-unit-test-storage-token';
const core=require('../lib/candriva-core');
test.after(()=>{
 require.cache[blobId].exports=previous;
 delete require.cache[coreId];
 if(existingToken===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
 else process.env.BLOB_READ_WRITE_TOKEN=existingToken;
});
const fakeUser=()=>({uid:randomUUID(),email:'synthetic@example.invalid',name:'Member storage QA'});
test('member creation tolerates two transient private Blob read misses',async()=>{
 saved.clear();readsAfterWriteToMiss=2;dropAllReads=false;
 const p=fakeUser(),result=await core.member(p);
 assert.equal(result.uid,p.uid);
 assert.equal(result.status,'locked');assert.equal(result.access,false);
 assert.equal(readsAfterWriteToMiss,0,'Both simulated stale reads must occur');
 const record=await core.read('cv2/members/'+p.uid+'.json');
 assert.equal(record.uid,p.uid);
 assert.equal(record.trialStartedAt,null);
});
test('simultaneous account first loads cannot create duplicate records or access',async()=>{
 saved.clear();readsAfterWriteToMiss=0;dropAllReads=false;
 const p=fakeUser();
 const [a,b]=await Promise.all([core.member(p),core.member(p)]);
 assert.equal(saved.size,1);
 assert.equal(a.uid,p.uid);assert.equal(b.uid,p.uid);
 assert.equal(a.status,'locked');assert.equal(b.status,'locked');
});
test('absent, corrupt or mismatched storage data fails closed',async()=>{
 saved.clear();readsAfterWriteToMiss=0;dropAllReads=true;
 await assert.rejects(core.member(fakeUser()),e=>e.status===503);
 dropAllReads=false;
 saved.clear();const p=fakeUser();
 saved.set('cv2/members/'+p.uid+'.json',JSON.stringify({uid:randomUUID(),trialStartedAt:null,trialEndsAt:null}));
 await assert.rejects(core.member(p),e=>e.status===503);
});
