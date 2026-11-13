'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
test('web wordmark includes verified pixels from original Super Admin logo source',()=>{
 const svg=fs.readFileSync(path.join(__dirname,'../signalchart-wordmark.svg'),'utf8');
 const m=svg.match(/data:image\/png;base64,([^"']+)/);
 assert.ok(m,'must embed original transparent PNG data');
 const data=Buffer.from(m[1],'base64');
 assert.equal(data.length,3159);
 assert.equal(crypto.createHash('sha256').update(data).digest('hex'),'2c924405ffe91b15deea4b2472115257f4dc110f788ce6d05c7c74f9e45cc93b');
 assert.equal(data.toString('ascii',1,4),'PNG');
});
test('site shell and admin dashboard use the official website wordmark',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../signalchart-shell.js'),'utf8');
 const ops=fs.readFileSync(path.join(__dirname,'../ops.html'),'utf8');
 assert.ok(js.includes('/signalchart-wordmark.svg'));
 assert.ok(ops.includes('/signalchart-wordmark.svg'));
 assert.ok(ops.includes('data-op-view="members"'));
 assert.ok(ops.includes('id="op-view-members"'));
 assert.ok(ops.includes('id="op-member-count"'));
 assert.doesNotMatch(ops,/id="ops-grant-form"/);
});
