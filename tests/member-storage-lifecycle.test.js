'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const originalBlob=require('@vercel/blob');
const blobId=require.resolve('@vercel/blob');
const originalExports=require.cache[blobId].exports;
const corePath=require.resolve('../lib/candriva-core');
const originalToken=process.env.BLOB_READ_WRITE_TOKEN;
const records=new Map();
function stream(body){
 return new ReadableStream({start(controller){
  controller.enqueue(Buffer.isBuffer(body)?body:Buffer.from(String(body)));
  controller.close();
 }});
}
require.cache[blobId].exports={
 ...originalBlob,
 get:async path=>records.has(path)?{stream:stream(records.get(path))}:null,
 put:async(path,body,options)=>{
  assert.equal(options.access,'private');
  assert.equal(options.allowOverwrite,false);
  if(records.has(path))throw Error('BlobAlreadyExistsError');
  records.set(path,body);
  return {pathname:path};
 },
 list:async({prefix})=>({
  blobs:[...records.keys()].filter(p=>p.startsWith(prefix)).map(pathname=>({pathname})),
  hasMore:false,cursor:null
 })
};
delete require.cache[corePath];
process.env.BLOB_READ_WRITE_TOKEN='synthetic-test-token-not-a-real-secret';
const core=require('../lib/candriva-core');
test.after(()=>{
 require.cache[blobId].exports=originalExports;
 delete require.cache[corePath];
 if(originalToken===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
 else process.env.BLOB_READ_WRITE_TOKEN=originalToken;
});
test('member record is written and immediately re-read without promoting any trial or admin access',async()=>{
 const uid=randomUUID(),user={uid,email:'sc-qa@example.test',name:'QA member'};
 const initial=await core.member(user);
 assert.equal(initial.uid,uid);
 assert.equal(initial.status,'locked');
 assert.equal(initial.access,false);
 assert.equal(initial.isAdmin,false);
 const record=await core.read('cv2/members/'+uid+'.json');
 assert.equal(record.uid,uid);
 assert.equal(record.trialStartedAt,null);
 assert.equal(record.trialEndsAt,null);
 assert.equal(record.email,user.email);
 const repeat=await core.member(user);
 assert.equal(repeat.uid,uid);
 assert.equal(repeat.status,'locked');
 assert.equal(records.size,1,'Repeated member lookup must not create multiple records');
 assert.throws(()=>core.adminOnly(initial),error=>error.status===403);
});
