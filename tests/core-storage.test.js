'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
test('private Blob writes use immutable unique paths and supported cache options',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/candriva-core.js'),'utf8');
 assert.ok(source.includes("access:'private'"));
 assert.ok(source.includes('allowOverwrite:false'));
 assert.ok(!source.includes('cacheControlMaxAge:0'));
});
