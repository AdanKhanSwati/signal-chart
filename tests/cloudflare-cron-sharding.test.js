'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const fs=require('node:fs');
const mod=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/auto-scanner.mjs')).href);
const audit=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/scan-audit.mjs')).href);
const HOUR=Date.UTC(2026,10,12,19);
test('One hour has four disjoint short Cloudflare cron batches covering all major scanner pairs once',async()=>{
 const {selectCronShard,SCAN_MINUTES}=await mod;
 assert.deepEqual(SCAN_MINUTES,[7,8,9,10]);
 const found=[];
 const expectedHour=new Date(HOUR).toISOString();
 for(let i=0;i<SCAN_MINUTES.length;i++){
  const slot=selectCronShard(HOUR+SCAN_MINUTES[i]*60000);
  assert.equal(slot.valid,true);
  assert.equal(slot.slot,i);
  assert.equal(slot.hourKey,expectedHour);
  assert.ok(slot.markets.length>=2&&slot.markets.length<=3);
  for(const pair of slot.markets){
   assert.ok(pair.market==='crypto'||pair.market==='forex');
   found.push(pair.market+':'+pair.symbol);
  }
 }
 assert.equal(found.length,11);
 assert.equal(new Set(found).size,11,'pairs must never be scanned twice in one hour');
 assert.equal(found.filter(x=>x.startsWith('crypto:')).length,8);
 assert.equal(found.filter(x=>x.startsWith('forex:')).length,3);
});
test('Invalid or forged cron schedule times are denied before fetching market/news or writing database rows',async()=>{
 const {selectCronShard,createAutoScanner}=await mod;
 for(const t of [undefined,null,NaN,0,HOUR+60000,HOUR+1300000]){
  assert.equal(selectCronShard(t).valid,false);
 }
 let calls=0;
 const scanner=createAutoScanner({fetchFn:async()=>{calls++;throw Error('No network')},
  researchHandler:async()=>{calls++;throw Error('No calendar')}});
 const env={SC_AUTO_RESEARCH_ENABLED:'true',SUPABASE_URL:'https://nnailvcgaupjtdaxvjsx.supabase.co',
  SUPABASE_SECRET_KEY:'sb_secret_'+'x'.repeat(40)};
 assert.equal((await scanner.scheduled(env,HOUR+60000)).status,'IGNORED_SCHEDULE');
 assert.equal((await scanner.scheduled(env)).status,'IGNORED_SCHEDULE');
 assert.equal(calls,0);
});
test('Four-minute multi-trigger schedule remains one Worker Cron expression and preserves dashboard variables',()=>{
 const cfg=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../cloudflare/wrangler.staging.json'),'utf8'));
 assert.deepEqual(cfg.triggers.crons,['7,8,9,10 * * * *']);
 assert.equal(cfg.keep_vars,true);
 assert.equal(cfg.workers_dev,true);
});
test('Append-only audit identifies the correct UTC hour and batch, never includes trade levels',async()=>{
 const {scanAuditPayload}=await audit;
 const out=scanAuditPayload({status:'PARTIAL_DATA',hourKey:new Date(HOUR).toISOString(),
  slot:2,scanned:3,qualified:0,counts:{DATA_UNAVAILABLE:1,NO_SETUP:2}});
 assert.equal(out.p_status,'PARTIAL_FAILURE');
 assert.equal(out.p_published,0);
 assert.equal(out.p_metadata.scanHour,'2026-11-12T19:00:00.000Z');
 assert.equal(out.p_metadata.shard,2);
 assert.deepEqual(out.p_metadata.counts,{DATA_UNAVAILABLE:1,NO_SETUP:2});
 assert.doesNotMatch(JSON.stringify(out),/BTCUSDT|entry|stopLoss|takeProfit|secret|wallet/i);
 const malicious=scanAuditPayload({status:'ERROR',hourKey:'bad string',slot:42,
  counts:{'BROKEN;DELETE':99,NO_SETUP:1}});
 assert.equal(malicious.p_metadata.scanHour,null);
 assert.equal(malicious.p_metadata.shard,null);
 assert.deepEqual(malicious.p_metadata.counts,{NO_SETUP:1});
});


test('Public staging scanner status proves Cron flag without leaking privileged keys or enabling publication',async()=>{
 const {pathToFileURL}=require('node:url');
 const workerModule=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/worker.mjs')).href);
 let upstream=0;
 const worker=workerModule.createWorker({fetchFn:async()=>{upstream++;throw Error('Status must stay offline')}});
 const url='https://staging.example.test/api/auto-signals?action=status';
 const active=await worker.fetch(new Request(url),{
  SC_AUTO_RESEARCH_ENABLED:'true',SC_AUTO_PUBLISH_ENABLED:'true',
  SUPABASE_SECRET_KEY:'sb_secret_'+'z'.repeat(40)
 });
 assert.equal(active.status,200);
 const body=await active.json();
 assert.equal(body.mode,'STAGING_RESEARCH_DRY_RUN');
 assert.equal(body.researchEnabled,true);
 assert.equal(body.publicationEnabled,false);
 assert.equal(body.publicationRouteConfigured,false);
 assert.deepEqual(body.scheduledMinutesUTC,[7,8,9,10]);
 assert.doesNotMatch(JSON.stringify(body),/sb_secret_|signing|password/);
 const disabled=await (await worker.fetch(new Request(url),{})).json();
 assert.equal(disabled.researchEnabled,false);
 assert.equal(disabled.publicationEnabled,false);
 assert.equal(upstream,0);
});
