'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {createHash}=require('node:crypto');
test('Launchers and PWA icons match approved two-bar image bytes, not legacy images',()=>{
 const read=p=>fs.readFileSync(path.join(root,p));
 const original=read('brand/approved-signalchart-two-bars.png');
 const launcher=read('mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png');
 const small=read('ops-icon-192.png');
 assert.equal(createHash('sha256').update(original).digest('hex'),'ad7a5070bd022ba16f0b5263a66cad3310f655fd0848b22763f51faf30561e3e');
 assert.deepEqual(launcher,small);
 assert.equal(small.toString('ascii',1,4),'PNG');
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
 assert.doesNotMatch(python,/ImageDraw|draw\.rectangle|polygon\(/i);
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/signalchart-icon-sync.yml'),'utf8');
 assert.match(workflow,/signalchart-cloudflare-free-migration/);
});

test('Android adaptive icon uses transparent mark-only foreground, no square frame',()=>{
 const xml=fs.readFileSync(path.join(root,'mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'),'utf8');
 assert.match(xml,/android:drawable="@android:color\/transparent"/);
 assert.match(xml,/@drawable\/ic_launcher_foreground/);
 const gradle=fs.readFileSync(path.join(root,'mobile/android/app/build.gradle'),'utf8');
 assert.match(gradle,/versionCode 2/);
 assert.match(gradle,/versionName '0\.2\.0'/);
});
