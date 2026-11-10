#!/usr/bin/env node
'use strict';
/**
 * Opt-in, self-cleaning private member storage check. Writes ONE disposable
 * synthetic record under cv2/members/ and deletes it in finally.
 * Never creates Auth accounts, phone claims, premium signals, or invoices.
 *
 * SC_QA_ALLOW_MEMBER_BLOB_PROBE=yes BLOB_READ_WRITE_TOKEN=... node scripts/member-blob-diagnostic.cjs
 */
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {del}=require('@vercel/blob');
const core=require('../lib/candriva-core');
if(process.env.SC_QA_ALLOW_MEMBER_BLOB_PROBE!=='yes'||
   !process.env.BLOB_READ_WRITE_TOKEN){
 console.error('Member Blob QA requires explicit opt-in and a server-only token');
 process.exit(2);
}
(async()=>{
 const uid=randomUUID(),path='cv2/members/'+uid+'.json';
 let touched=false;
 const person={uid,email:'synthetic-qa@example.invalid',name:'Temporary member QA'};
 try{
  const member=await core.member(person);
  // If the member returned, core.ensureMember must have stored or found this ID.
  touched=true;
  const raw=await core.read(path);
  const matching=raw?.uid===uid;
  const fields=raw?Object.keys(raw).sort():[];
  const trialStart=raw?.trialStartedAt;
  const trialEnd=raw?.trialEndsAt;
  const status=member.status;
  const second=await core.member(person);
  console.log('MEMBER_DIAGNOSTIC',JSON.stringify({
   persisted:matching,fields,trialStartIsNull:trialStart===null,
   trialStartIsUndefined:trialStart===undefined,trialEndIsNull:trialEnd===null,
   status,hasAccess:member.access===true,admin:member.isAdmin===true,
   idempotent:second.uid===uid&&second.status===status
  }));
  assert.equal(matching,true,'Member did not persist under expected canonical key');
  assert.equal(trialStart,null,'New QA member has an unexpected legacy trial start');
  assert.equal(trialEnd,null,'New QA member has an unexpected legacy trial end');
  assert.equal(status,'locked','QA member unexpectedly granted access');
  assert.equal(member.access,false);
  assert.equal(member.isAdmin,false);
  assert.equal(second.status,status);
 }finally{
  // Cleanup even if member() threw after its first write.
  try{await del(path);console.log('MEMBER_DIAGNOSTIC_CLEANUP',true)}
  catch(e){console.error('MEMBER_DIAGNOSTIC_CLEANUP',false);process.exitCode=1}
 }
})().catch(e=>{console.error('MEMBER_DIAGNOSTIC_FAIL',e.message);process.exitCode=1});
