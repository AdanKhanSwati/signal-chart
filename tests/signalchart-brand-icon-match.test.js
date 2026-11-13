'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('Launchers and PWA icons match approved two-bar image bytes, not legacy images',()=>{
 const read=p=>fs.readFileSync(path.join(root,p));
 const original=read('brand/approved-signalchart-two-bars.png');
 const launcher=read('mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png');
 const small=read('ops-icon-192.png');
 assert.deepEqual(small,original);
 assert.deepEqual(launcher,original);
 for(const svg of ['signalchart-mark.svg','ops-icon.svg']){
   assert.match(read(svg).toString('utf8'),/data:image\/png;base64,/);
   assert.match(read(svg).toString('utf8'),/SignalChart approved two-bar mark/);
 }
 const png512=read('ops-icon-512.png');
 assert.equal(png512.toString('ascii',1,4),'PNG');
 assert.deepEqual(read('mobile/android/app/src/main/res/drawable/brand_icon.png'),png512);
});
test('Brand source, resizer and sync action are documented as exact supplied artwork',()=>{
 const python=fs.readFileSync(path.join(root,'scripts/sync-signalchart-icons.py'),'utf8');
 assert.match(python,/approved-signalchart-two-bars\.png/);
 assert.doesNotMatch(python,/DRAW|draw\.rectangle|polygon\(/i);
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/signalchart-icon-sync.yml'),'utf8');
 assert.match(workflow,/signalchart-cloudflare-free-migration/);
});
