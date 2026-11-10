'use strict';
/** Build a static Cloudflare asset directory WITHOUT copying API/source/secrets.
 * This is a staging-only static build; dynamic API migration is separate.
 */
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const manifest=require('../cloudflare/public-assets.json');

function exportAssets({sourceRoot=root,outDir=path.join(root,'.cloudflare-dist')}={}){
 const files=manifest.files;
 if(!Array.isArray(files)||files.length<1||new Set(files).size!==files.length)
  throw Error('Invalid approved asset manifest');
 for(const file of files){
  if(typeof file!=='string'||
     !/^[a-z0-9][a-z0-9._-]*\.(html|css|js|svg|png|webmanifest|ico)$/i.test(file)||
     file==='setup.html')
   throw Error('Unapproved static asset name');
  const src=path.join(sourceRoot,file);
  if(!fs.existsSync(src)||!fs.lstatSync(src).isFile())
   throw Error('Approved static asset is missing or is not a regular file: '+file);
 }
 // Never copy entire directories, git metadata, environment files, or backend code.
 fs.rmSync(outDir,{recursive:true,force:true});
 fs.mkdirSync(outDir,{recursive:true});
 for(const file of files)fs.copyFileSync(path.join(sourceRoot,file),path.join(outDir,file));
 return {outDir,files:files.length};
}
if(require.main===module){
 const result=exportAssets();
 console.log('Cloudflare static preview prepared:',result.files,'approved public assets');
 console.log('Dynamic /api/* routes are NOT implemented by this static build.');
}
module.exports={exportAssets};
