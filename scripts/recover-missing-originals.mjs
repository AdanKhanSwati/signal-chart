#!/usr/bin/env node
/**
 * Recover the 11 SHA1-unverified original files from SignalChart's CLI-uploaded
 * Vercel deployment without overwriting rebuilt staging modules.
 *
 * Usage: VERCEL_TOKEN=<local read-only Vercel token> node scripts/recover-missing-originals.mjs
 *
 * The token must be provided only via a private shell/secret manager, never
 * pasted into ChatGPT, Vercel public env vars, GitHub, or logs.
 */
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,open} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';

const ROOT=resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await readFile(join(ROOT,'recovery-manifest.json'),'utf8'));
const deployment=manifest.originalDeploymentId;
const team=manifest.teamId;
const token=process.env.VERCEL_TOKEN;
if(!/^dpl_[A-Za-z0-9]+$/.test(deployment)||!/^team_[A-Za-z0-9]+$/.test(team))
 throw Error('Unexpected source manifest deployment or team');
if(!token)throw Error('VERCEL_TOKEN is required in the private local environment; never paste it in chat');
const origin='https://api.vercel.com',timeout=15000;
const dir=resolve(ROOT,'vercel-recovered','original-missing');
const safeName=p=>typeof p==='string'&&/^[a-zA-Z0-9_.\/-]+$/.test(p)&&
 !p.startsWith('/')&&!p.split('/').some(x=>x==='..'||x==='.');
const readJSON=async path=>{
 const res=await fetch(origin+path,{
  headers:{Authorization:'Bearer '+token,Accept:'application/json'},
  signal:AbortSignal.timeout(timeout),cache:'no-store'
 });
 if(!res.ok)throw new Error('Vercel source retrieval returned '+res.status);
 return res.json();
};
const qs='?teamId='+encodeURIComponent(team);
const metadata=await readJSON('/v6/deployments/'+encodeURIComponent(deployment)+'/files'+qs);
const root=(Array.isArray(metadata)?metadata:metadata.result||metadata.files||[])
 .find(x=>x.name==='src'&&x.type==='directory');
if(!root)throw Error('The source tree of the original deployment was not returned');
const entries=new Map();
function walk(children,prefix=''){
 for(const e of children||[]){
  const path=prefix+e.name;
  if(!safeName(path))throw Error('Unexpected source filename');
  if(e.type==='directory')walk(e.children,path+'/');
  else if(e.type==='file')entries.set(path,e.uid);
 }
}
walk(root.children);
let recovered=0;
for(const f of manifest.missingFiles){
 if(!safeName(f.path)||!/^[0-9a-f]{40}$/.test(f.sha1))throw Error('Invalid original manifest');
 const uid=entries.get(f.path);
 if(uid!==f.sha1)throw Error('Source tree SHA1 differs from original manifest: '+f.path);
 const record=await readJSON('/v8/deployments/'+encodeURIComponent(deployment)+
  '/files/'+encodeURIComponent(uid)+qs);
 const payload=record?.data??record?.content??record?.result?.data;
 if(typeof payload!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(payload))
  throw Error('No complete base64 payload returned for '+f.path);
 const bytes=Buffer.from(payload,'base64');
 if(createHash('sha1').update(bytes).digest('hex')!==f.sha1)
  throw Error('Original SHA1 mismatch; refuse recovered file '+f.path);
 const output=join(dir,f.path);
 await mkdir(dirname(output),{recursive:true});
 // Never overwrite local recovered evidence or active application source.
 const handle=await open(output,'wx').catch(e=>{
  if(e.code==='EEXIST')return null;throw e;
 });
 if(handle){try{await handle.writeFile(bytes)}finally{await handle.close()}}
 else{
  const previous=await readFile(output);
  if(createHash('sha1').update(previous).digest('hex')!==f.sha1)
   throw Error('Existing recovery evidence was modified: '+f.path);
 }
 recovered++;
 console.log('Verified original '+recovered+'/'+manifest.missingFiles.length+': '+f.path);
}
console.log('Verified all '+recovered+' original files. Files remain ignored and were not added to GitHub or deployed.');
