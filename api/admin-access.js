'use strict';
const {createGrantEvent,createRevokeEvent,resolveManualGrants}=require('../lib/manual-access');
const UID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function issue(code,message){return Object.assign(new Error(message),{status:code})}
function safeUid(value){
 if(typeof value!=='string'||!UID.test(value))throw issue(400,'Invalid member or grant identifier');
 return value.toLowerCase();
}
function createHandler(core){
 const {identity,member,adminOnly,records,write,handleError}=core;
 return async function(req,res){
  res.setHeader('Cache-Control','no-store, private');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const actor=await identity(req);const account=await member(actor);adminOnly(account);
   const action=String(req.query?.action||'');
   if(req.method==='GET'&&action==='members'){
    const q=String(req.query?.q||'').trim().toLowerCase().slice(0,100);
    const found=await records('cv2/members/',2000);const unique=new Map();
    for(const v of found){
     if(!v||!UID.test(String(v.uid||'')))continue;
     const uid=v.uid.toLowerCase();
     if(q&&!uid.includes(q)&&!String(v.email||'').toLowerCase().includes(q))continue;
     if(!unique.has(uid))unique.set(uid,{uid,email:v.email||'—',name:v.name||'',createdAt:v.createdAt||v.trialStartedAt});
    }
    return res.status(200).json({members:[...unique.values()].slice(0,200),partial:unique.size>200});
   }
   if(req.method==='GET'&&action==='grants'){
    const memberId=safeUid(req.query?.memberId);
    const events=await records('cv5/grants/'+memberId+'/',1000);
    return res.status(200).json({memberId,events,active:resolveManualGrants(events,Date.now(),memberId)});
   }
   if(req.method==='POST'&&['grant','revoke'].includes(action)){
    const body=req.body&&typeof req.body==='object'&&!Array.isArray(req.body)?req.body:{};
    const memberId=safeUid(body.memberId);
    const existing=(await records('cv2/members/',2000)).some(r=>String(r.uid||'').toLowerCase()===memberId);
    if(!existing)throw issue(404,'Member not found. The customer must first complete sign-in.');
    let event;
    if(action==='grant'){
     try{event=createGrantEvent({memberId,startsAt:body.startsAt,expiresAt:body.expiresAt,reason:body.reason},{adminUserId:actor.uid})}
     catch(e){throw issue(400,e.message)}
    }else{
     const grantId=safeUid(body.grantId),events=await records('cv5/grants/'+memberId+'/',1000);
     if(!events.some(e=>e.type==='grant'&&e.id===grantId))throw issue(404,'Grant not found');
     if(events.some(e=>e.type==='revoke'&&e.grantId===grantId))throw issue(409,'Grant has already been revoked');
     try{event=createRevokeEvent({memberId,grantId,reason:body.reason},{adminUserId:actor.uid})}
     catch(e){throw issue(400,e.message)}
    }
    await write('cv5/grants/'+memberId+'/'+event.id+'.json',event);
    return res.status(201).json({event});
   }
   throw issue(405,'Unsupported admin action or HTTP method');
  }catch(e){return handleError(res,e)}
 }
}
async function handler(req,res){return createHandler(require('../lib/candriva-core'))(req,res)}
module.exports=handler;
module.exports.createHandler=createHandler;
