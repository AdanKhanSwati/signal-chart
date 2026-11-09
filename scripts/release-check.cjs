#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'recovery-manifest.json'),'utf8'));
const changed=new Set(['api/config.js','lib/subscription-rules.js','candriva-v2.js','account.html','billing.html','home.html','vercel.json','signalchart-wordmark.svg','ops.html','site-app.js','README.txt','app.js','candriva-ui.js','dashboard.js','forex.html','membership.js','signals.html','crypto.html','package.json']);
const failures=[];const warnings=[];
// Keep the original-source gate intact. An independently rewritten replacement
// is not evidence that its pre-deployment source was recovered or QA-equivalent.
const reconstructedUnverified=[];
const missingFromWorkingTree=[];
const requireFile=(p)=>{const q=path.join(root,p);if(!fs.existsSync(q)){failures.push('Missing required file: '+p);return null}return fs.readFileSync(q)};
for(const item of manifest.recoveredFiles){
 const buffer=requireFile(item.path);
 if(buffer&&!changed.has(item.path)){
  const h=crypto.createHash('sha1').update(buffer).digest('hex');
  if(h!==item.sha1)failures.push('Unexpected change in recovered source: '+item.path);
 }
}
for(const f of manifest.missingFiles){
 if(fs.existsSync(path.join(root,f.path)))reconstructedUnverified.push(f.path);
 else missingFromWorkingTree.push(f.path);
 failures.push('Unrecovered original source: '+f.path);
}
if(!fs.existsSync(path.join(root,'tests/24h-trial.test.js')))failures.push('Missing legacy-trial regression test');
if(!fs.existsSync(path.join(root,'tests/trial-postgres.integration.mjs')))failures.push('Missing live-SQL integration test');
for(const file of ['api/trial.js','api/premium-signals.js','lib/trial-gate.js','sc-trial-ui.js']){
 if(!fs.existsSync(path.join(root,file)))failures.push('Missing 72-hour trial security component: '+file);
}
for(const file of ['20261109180000_sc_trial_foundation.sql','20261109180100_sc_trial_functions.sql','20261109180200_sc_trial_admin.sql','20261109180300_sc_legacy_guard.sql']){
 if(!fs.existsSync(path.join(root,'supabase/migrations',file)))failures.push('Missing Supabase migration: '+file);
}

if(fs.existsSync(path.join(root,'api/config.js'))){
 const conf=fs.readFileSync(path.join(root,'api/config.js'),'utf8');
 if(!conf.includes('trialHours:72')||!conf.includes('trialSignalLimit:3')||!conf.includes('requiresVerifiedPhone:true'))
  failures.push('API configuration does not specify 72 hours / 3 signals / verified phone');
}
if(fs.existsSync(path.join(root,'lib/subscription-rules.js'))){
 const rules=fs.readFileSync(path.join(root,'lib/subscription-rules.js'),'utf8');
 if(!fs.existsSync(path.join(root,'api/trial.js'))||!fs.existsSync(path.join(root,'api/premium-signals.js')))failures.push('Missing mandatory OTP and premium signal authorization routes');
}
const oldBrand=fs.readFileSync(path.join(root,'signalchart-wordmark.svg'),'utf8');
if(!oldBrand.includes('data:image/png;base64'))failures.push('Website logo is still the old reconstructed SVG, not the supplied original image');
const total=manifest.sourceFileCount,available=total-manifest.missingFiles.length;
const result={pass:failures.length===0,originalFiles:total,verifiableRestored:available,
 originalSourcesStillUnverified:manifest.missingFiles.length,
 rewrittenPresentButOriginalUnverified:reconstructedUnverified,
 genuinelyMissingFromWorkingTree:missingFromWorkingTree,
 errors:failures,warnings};
console.log(JSON.stringify(result,null,2));
if(failures.length)process.exitCode=1;
