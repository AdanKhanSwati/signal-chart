#!/usr/bin/env node
'use strict';
/**
 * SignalChart opt-in positive Auth + protected staging HTTP QA.
 *
 * Precondition: a DEDICATED, previously verified QA email account with
 * credentials supplied only as execution environment variables.
 * This script does not register users, send emails, activate trials, spend
 * trial credits, submit payment screenshots or change billing configuration.
 *
 * SC_QA_EMAIL=... SC_QA_PASSWORD=... SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... \
 * SC_STAGING_URL=https://...vercel.app VERCEL_AUTOMATION_BYPASS_SECRET=... \
 * node scripts/customer-session-smoke.cjs
 *
 * All private values are kept out of console output.
 */
const assert=require('node:assert/strict');
const {identity,authConfig}=require('../lib/candriva-core');
const env=process.env;
const email=String(env.SC_QA_EMAIL||'').trim().toLowerCase(),password=String(env.SC_QA_PASSWORD||'');
const origin=String(env.SC_STAGING_URL||'').trim().replace(/\/+$/,'');
function preflight(){
 assert.ok(email.includes('+signalchartqa')&&/^[^@]+@[^@]+\.[^@]+$/.test(email),
  'Use a dedicated SignalChart QA email alias, never a customer or administrator account');
 assert.ok(password.length>=12,'QA password must be provided securely');
 const cfg=authConfig();
 assert.ok(cfg.ready,'Public Supabase auth configuration unavailable');
 assert.ok(/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin),'Provide the protected staging preview URL');
 return cfg;
}
async function json(url,headers={},body=undefined){
 const res=await fetch(url,{method:body===undefined?'GET':'POST',
  headers:{Accept:'application/json',...headers,...(body!==undefined?{'Content-Type':'application/json'}:{})},
  body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',
  signal:AbortSignal.timeout(15000)});
 const obj=await res.json().catch(()=>({}));
 return {status:res.status,data:obj};
}
async function run(){
 const {url,key}=preflight();
 const response=await json(url+'/auth/v1/token?grant_type=password',{apikey:key},{email,password});
 assert.equal(response.status,200,'Dedicated QA account could not authenticate; verify email and password');
 const session=response.data;
 assert.ok(typeof session.access_token==='string'&&session.access_token.length>80,
  'No legitimate Supabase access token returned');
 const verified=await identity({headers:{authorization:'Bearer '+session.access_token}});
 assert.equal(verified.email,email,'Supabase identity mismatch');
 assert.ok(verified.uid,'Verified member UID missing');
 const bypass=String(env.VERCEL_AUTOMATION_BYPASS_SECRET||'');
 if(!bypass)throw Error('Protected staging bypass secret is required to test HTTP routes');
 const headers={Authorization:'Bearer '+session.access_token,'x-vercel-protection-bypass':bypass};
 const member=await json(origin+'/api/member?action=me',headers);
 assert.equal(member.status,200,'Authenticated member endpoint unavailable');
 assert.equal(member.data?.account?.uid,verified.uid,'HTTP membership identity mismatch');
 assert.equal(member.data?.account?.isAdmin,false,'QA identity must not be an administrator');
 assert.equal(member.data?.account?.uid,session.user?.id??verified.uid,'User session must match membership record');
 assert.equal(member.data?.account?.access,false,'Fresh QA member must not have premium access before trial verification');
 assert.equal(member.data?.account?.signalsUsed,0,'QA identity must begin without trial signal consumption');
 assert.equal(member.data?.payment?.enabled,false,'Staging payment collection must be disabled');
 const trial=await json(origin+'/api/trial?action=state',headers);
 assert.equal(trial.status,200,'Authenticated trial state unavailable');
 assert.ok(typeof trial.data?.trialStatus==='string');
 const admin=await json(origin+'/api/member?action=admin_payments',headers);
 assert.equal(admin.status,403,'Ordinary member accessed the admin payment queue');
 const payment=await json(origin+'/api/cv-ops?action=submit_payment',headers,
  {txid:'f'.repeat(64),receipt:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',note:'Synthetic QA rejected payment'});
 assert.equal(payment.status,503,'Staging payment submission must remain disabled');
 const otp=await json(origin+'/api/trial?action=otp_start',headers,{phone:'+923001234567'});
 assert.equal(otp.status,503,'Staging WhatsApp OTP delivery must remain disabled');
 const publicFeed=await json(origin+'/api/premium-signals?action=list',{'x-vercel-protection-bypass':bypass});
 assert.equal(publicFeed.status,200);
 assert.ok(Array.isArray(publicFeed.data?.signals));
 console.log(JSON.stringify({result:'PASS',dedicatedVerifiedAuth:true,memberRoute:true,
  trialState:true,adminIsolation:true,stagingPaymentDisabled:true,
  whatsappDeliveryDisabled:true,premiumListNoPrivateData:true},null,2));
}
run().catch(e=>{console.error('CUSTOMER_SESSION_QA_FAILED:',e.message);process.exitCode=1});
