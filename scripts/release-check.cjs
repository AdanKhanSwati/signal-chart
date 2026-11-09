#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'recovery-manifest.json'),'utf8'));
const changed=new Set(['api/config.js','lib/subscription-rules.js','candriva-v2.js','account.html','billing.html','home.html','vercel.json','signalchart-wordmark.svg','ops.html','site-app.js','README.txt','app.js','candriva-ui.js','dashboard.js','forex.html','membership.js']);
const failures=[];const warnings=[];
const requireFile=(p)=>{const q=path.join(root,p);if(!fs.existsSync(q)){failures.push('Missing required file: '+p);return null}return fs.readFileSync(q)};
for(const item of manifest.recoveredFiles){
 const buffer=requireFile(item.path);
 if(buffer&&!changed.has(item.path)){
  const h=crypto.createHash('sha1').update(buffer).digest('hex');
  if(h!==item.sha1)failures.push('Unexpected change in recovered source: '+item.path);
 }
}
for(const f of manifest.missingFiles)failures.push('Unrecovered original source: '+f.path);
if(!fs.existsSync(path.join(root,'tests/24h-trial.test.js')))failures.push('Missing 24-hour trial regression test');
if(fs.existsSync(path.join(root,'api/config.js'))){
 const conf=fs.readFileSync(path.join(root,'api/config.js'),'utf8');
 if(!conf.includes('trialHours:24'))failures.push('API config is not set to 24-hour trial');
}
if(fs.existsSync(path.join(root,'lib/subscription-rules.js'))){
 const rules=fs.readFileSync(path.join(root,'lib/subscription-rules.js'),'utf8');
 if(!rules.includes('start+24*HOUR'))failures.push('Entitlement rules do not enforce 24 hours');
}
const oldBrand=fs.readFileSync(path.join(root,'signalchart-wordmark.svg'),'utf8');
if(!oldBrand.includes('data:image/png;base64'))failures.push('Website logo is still the old reconstructed SVG, not the supplied original image');
const total=manifest.sourceFileCount,available=total-manifest.missingFiles.length;
const result={pass:failures.length===0,originalFiles:total,verifiableRestored:available,errors:failures,warnings};
console.log(JSON.stringify(result,null,2));
if(failures.length)process.exitCode=1;
