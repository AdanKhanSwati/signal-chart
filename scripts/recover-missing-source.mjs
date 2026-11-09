#!/usr/bin/env node
// Read-only fetch of missing original source; requires a Vercel access token
// in VERCEL_TOKEN. Never paste tokens into a chat or store them in the repo.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const token=process.env.VERCEL_TOKEN;
if(!token) { console.error('Missing VERCEL_TOKEN environment secret'); process.exit(2); }
const manifest=JSON.parse(await fs.readFile(new URL('../recovery-manifest.json', import.meta.url),'utf8'));
const dir=path.resolve(process.env.SIGNALCHART_RECOVERY_DIR||'./vercel-recovered');
const prefix='https://api.vercel.com/v8/deployments/'+encodeURIComponent(manifest.originalDeploymentId)+'/files/';
const qs='?teamId='+encodeURIComponent(manifest.teamId);
let recovered=0,failed=[];
for(const entry of manifest.missingFiles){
 try{
  if(!/^[\w./-]+$/.test(entry.path)||entry.path.startsWith('/')||entry.path.split('/').includes('..'))throw Error('unsafe path');
  const response=await fetch(prefix+encodeURIComponent(entry.sha1)+qs,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  const json=await response.json();
  const b64=json.data||json.result?.data;
  if(typeof b64!=='string')throw Error('missing base64');
  const bytes=Buffer.from(b64,'base64');
  if(crypto.createHash('sha1').update(bytes).digest('hex')!==entry.sha1)throw Error('SHA1 mismatch');
  const target=path.join(dir,entry.path);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,bytes);
  recovered++;
 }catch(e){failed.push({path:entry.path,error:String(e.message||e)});}
}
console.log('Verified missing-file recovery:',recovered+'/'+manifest.missingFiles.length);
if(failed.length){console.error('Failures:',JSON.stringify(failed));process.exitCode=1;}
