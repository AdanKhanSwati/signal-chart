'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../api/admin-access');
const ADMIN='33333333-3333-4333-8333-333333333333',USER='11111111-1111-4111-8111-111111111111';
const store=[{uid:USER,email:'member@example.net',trialStartedAt:'2026-11-08T00:00:00.000Z',trialEndsAt:'2026-11-11T00:00:00.000Z'}];
function setup({isAdmin=true,invalidSession=false}={}){
 const writes=[],eventRecords=[];
 const core={
  identity:async()=>{if(invalidSession)throw Object.assign(new Error('Sign in required'),{status:401});return {uid:ADMIN,email:'admin@example.net'}},
  member:async()=>({isAdmin}),
  adminOnly:s=>{if(!s.isAdmin)throw Object.assign(new Error('Administrator permission required'),{status:403})},
  records:async prefix=>prefix==='cv2/members/'?store:prefix.startsWith('cv5/grants/')?eventRecords:[],
  write:async(path,event)=>{writes.push({path,event});eventRecords.push(event)},
  handleError:(res,error)=>res.status(error.status||500).json({error:error.message})
 };
 const handler=createHandler(core);
 async function request(method,action,body={},query={}){
  const res={code:200,data:null,setHeader(){return this},status(c){this.code=c;return this},json(d){this.data=d;return this}};
  await handler({method,query:{action,...query},body,headers:{}},res);return res;
 }
 return {request,writes,eventRecords};
}
test('ordinary member is denied all admin reads and writes',async()=>{
 const x=setup({isAdmin:false});
 assert.equal((await x.request('GET','members')).code,403);
 assert.equal((await x.request('POST','grant',{memberId:USER,expiresAt:'2100-01-01T00:00:00Z',reason:'Test'})).code,403);
 assert.equal(x.writes.length,0);
});
test('unauthenticated member cannot access admin functions',async()=>{
 const x=setup({invalidSession:true});
 assert.equal((await x.request('GET','members')).code,401);assert.equal(x.writes.length,0);
});
test('admin can search existing members without exposing passwords',async()=>{
 const x=setup();const r=await x.request('GET','members',{}, {q:'member@'});
 assert.equal(r.code,200);assert.equal(r.data.members.length,1);
 assert.deepEqual(Object.keys(r.data.members[0]).sort(),['createdAt','email','name','uid']);
});
test('manual grant is append-only and returns server-generated event',async()=>{
 const x=setup();const r=await x.request('POST','grant',{memberId:USER,expiresAt:'2100-01-01T00:00:00Z',reason:'Founder complimentary access'});
 assert.equal(r.code,201);assert.equal(r.data.event.memberId,USER);assert.equal(x.writes.length,1);
 assert.match(x.writes[0].path,/^cv5\/grants\/11111111.*\/[a-f0-9-]+\.json$/);
});
test('admin can revoke exactly one existing grant',async()=>{
 const x=setup();const g=await x.request('POST','grant',{memberId:USER,expiresAt:'2100-01-01T00:00:00Z',reason:'Founder access'});
 const r=await x.request('POST','revoke',{memberId:USER,grantId:g.data.event.id,reason:'No longer required'});
 assert.equal(r.code,201);assert.equal(r.data.event.grantId,g.data.event.id);
 assert.equal((await x.request('POST','revoke',{memberId:USER,grantId:g.data.event.id,reason:'Duplicate'})).code,409);
});
test('unknown member cannot receive access',async()=>{
 const x=setup();const r=await x.request('POST','grant',{memberId:'22222222-2222-4222-8222-222222222222',expiresAt:'2100-01-01T00:00:00Z',reason:'Test'});
 assert.equal(r.code,404);assert.equal(x.writes.length,0);
});
test('invalid identifiers and expiry cannot grant access',async()=>{
 const x=setup();assert.equal((await x.request('POST','grant',{memberId:'not-an-id',expiresAt:'2100-01-01T00:00:00Z',reason:'Test'})).code,400);
 assert.equal((await x.request('POST','grant',{memberId:USER,expiresAt:'2000-01-01T00:00:00Z',reason:'Test'})).code,500);
 assert.equal(x.writes.length,0);
});
