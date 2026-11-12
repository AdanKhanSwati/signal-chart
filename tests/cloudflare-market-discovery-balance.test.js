'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../market-charts.js'),'utf8');
const start=source.indexOf('function balancedMarkets(');
const end=source.indexOf('\nfunction renderWatch(){',start);
assert.ok(start>=0&&end>start,'Market balancing helper should be defined');
const balancedMarkets=vm.runInNewContext('('+source.slice(start,end).trim()+')');
const markets=(type,count)=>Array.from({length:count},(_,i)=>({type,s:type.toUpperCase()+i}));

test('Default mobile market list includes both market classes when futures dominate',()=>{
 const selected=balancedMarkets([...markets('crypto',600),...markets('forex',55)],24);
 assert.equal(selected.length,24);
 assert.equal(selected.filter(x=>x.type==='crypto').length,12);
 assert.equal(selected.filter(x=>x.type==='forex').length,12);
});

test('Forex-only and crypto-only filters show every matching instrument up to the limit',()=>{
 const fx=markets('forex',55),coins=markets('crypto',300);
 assert.deepEqual(Array.from(balancedMarkets(fx,24),x=>x.s),fx.slice(0,24).map(x=>x.s));
 assert.deepEqual(Array.from(balancedMarkets(coins,24),x=>x.s),coins.slice(0,24).map(x=>x.s));
});

test('Scarce markets do not leave empty slots and all available symbols are eligible',()=>{
 const selected=balancedMarkets([...markets('crypto',500),...markets('forex',2)],24);
 assert.equal(selected.length,24);
 assert.equal(selected.filter(x=>x.type==='forex').length,2);
 assert.equal(selected.filter(x=>x.type==='crypto').length,22);
 assert.equal(balancedMarkets([...markets('crypto',5),...markets('forex',3)],24).length,8);
});

test('Default overview includes both assets without introducing a large mobile DOM',()=>{
 const all=[...markets('crypto',600),...markets('forex',55)];
 const sample=balancedMarkets(all,80);
 assert.equal(sample.length,80);
 assert.equal(sample.filter(x=>x.type==='forex').length,40);
 assert.match(source,/for\(const p of balancedMarkets\(filtered,limit\)\)/);
 assert.match(source,/for\(const p of balancedMarkets\(pairs,80\)\)/);
 assert.match(source,/if\(filtered.length>limit\)/);
});
