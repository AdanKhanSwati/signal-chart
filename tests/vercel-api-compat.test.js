'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHandler}=require('../api/compat');
const root=path.join(__dirname,'..'),config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
const routes=['checkout','cv-ops','crypto','forex','signals','candriva'];
function res(){
 return {code:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v;return this},
  status(v){this.code=v;return this},json(v){this.body=v;return this}};
}
test('existing API paths rewrite to the same allowlisted secure handler',()=>{
 const rules=config.rewrites.filter(x=>x.source.startsWith('/api/'));
 for(const route of routes){
  assert.ok(rules.some(x=>x.source==='/api/'+route&&x.destination==='/api/compat?sc_route='+route));
 }
 assert.equal(config.git.deploymentEnabled['signalchart-recovery-staging'],false);
});
test('Vercel deployment bundles no more than 12 functions on Hobby',()=>{
 const ignored=fs.readFileSync(path.join(root,'.vercelignore'),'utf8').split(/\r?\n/)
  .map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
 assert.deepEqual(ignored.map(x=>x.replace('api/','').replace('.js','')).sort(),routes.slice().sort());
 for(const route of routes)assert.ok(fs.existsSync(path.join(root,'lib/api-compat',route+'.js')));
 const total=fs.readdirSync(path.join(root,'api')).filter(x=>x.endsWith('.js')).length;
 assert.ok(total-ignored.length<=12,'deployment must fit 12 serverless functions');
});
test('unknown compatibility route cannot load arbitrary implementation',async()=>{
 const r=res();
 await createHandler()({method:'GET',query:{sc_route:'../candriva-core'},headers:{}},r);
 assert.equal(r.code,404);
 assert.equal(r.headers['Cache-Control'],'no-store, private');
});
test('compatibility handler preserves HTTP method and request to the underlying module',async()=>{
 let called=false;
 const handler=createHandler({demo:()=>async(req,response)=>{
  called=true;assert.equal(req.method,'PATCH');assert.equal(req.query.action,'me');
  return response.status(405).json({error:'Method forbidden'});
 }});
 const r=res();
 await handler({method:'PATCH',query:{sc_route:'demo',action:'me'},headers:{}},r);
 assert.equal(called,true);assert.equal(r.code,405);
});
test('compatibility implementation and original test imports match byte for byte except require paths',()=>{
 for(const route of routes){
  const original=fs.readFileSync(path.join(root,'api',route+'.js'),'utf8');
  const shared=fs.readFileSync(path.join(root,'lib/api-compat',route+'.js'),'utf8');
  assert.equal(shared,original.replaceAll("require('../lib/","require('../"),route+' implementation differs');
 }
});
