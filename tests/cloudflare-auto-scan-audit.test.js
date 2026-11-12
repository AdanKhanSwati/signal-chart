'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const audit=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/scan-audit.mjs')).href);
const scannerModule=import(pathToFileURL(path.resolve(__dirname,'../cloudflare/auto-scanner.mjs')).href);
const NOW=Date.UTC(2026,10,12,19,8);
const secret='sb_secret_'+'a'.repeat(42);
const env={SC_AUTO_RESEARCH_ENABLED:'true',SUPABASE_URL:'https://nnailvcgaupjtdaxvjsx.supabase.co',SUPABASE_SECRET_KEY:secret};

test('Dry-run audit SQL payload is append-only, bounded, and never records trade levels',async()=>{
 const {scanAuditPayload}=await audit;
 const out=scanAuditPayload({status:'SCAN_COMPLETED',scanned:11,qualified:2,counts:{NO_SETUP:9,CANDIDATE_UNPUBLISHED:2}});
 assert.deepEqual([out.p_status,out.p_scanned,out.p_qualified,out.p_published,out.p_errors],['COMPLETED',11,2,0,0]);
 assert.equal(out.p_metadata.mode,'cloudflare_dry_run');
 assert.equal(out.p_metadata.published,false);
 assert.doesNotMatch(JSON.stringify(out),/stopLoss|takeProfit|signalKey|wallet|user_id|entry/);
 assert.equal(scanAuditPayload({status:'BLOCKED_NEWS_DATA',scanned:0}).p_status,'BLOCKED_NEWS_DATA');
 assert.equal(scanAuditPayload({status:'PARTIAL_DATA',scanned:8,counts:{DATA_UNAVAILABLE:3}}).p_status,'PARTIAL_FAILURE');
 assert.equal(scanAuditPayload({status:'BAD_STATE'}).p_status,'ERROR');
 assert.throws(()=>scanAuditPayload({status:'SCAN_COMPLETED',scanned:300}),/Invalid scan audit counts/);
});
test('Service-role-key audit sends only a server-to-server RPC and no customer data',async()=>{
 const {saveDryRunAudit}=await audit;
 let calls=0;
 const r=await saveDryRunAudit(async(url,options)=>{
  calls++;
  assert.equal(url,env.SUPABASE_URL+'/rest/v1/rpc/sc_record_auto_scan');
  assert.equal(options.method,'POST');
  assert.equal(options.headers.apikey,secret);
  assert.equal(options.headers.Authorization,undefined);
  const data=JSON.parse(options.body);
  assert.equal(data.p_published,0);
  assert.equal(data.p_status,'COMPLETED');
  assert.deepEqual(data.p_metadata.counts,{NO_SETUP:1});
  return new Response(null,{status:204});
 },env,{status:'SCAN_COMPLETED',scanned:1,qualified:0,counts:{NO_SETUP:1}});
 assert.deepEqual(r,{saved:true});
 assert.equal(calls,1);
});
test('No privileged key means no audit request; external failure never grants publication',async()=>{
 const {saveDryRunAudit}=await audit;
 let calls=0;
 const missing=await saveDryRunAudit(async()=>{calls++;throw Error('network')},{
  SUPABASE_URL:env.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'},
 {status:'ERROR',scanned:0});
 assert.deepEqual(missing,{saved:false,reason:'NOT_CONFIGURED'});
 assert.equal(calls,0);
 const failed=await saveDryRunAudit(async()=>new Response('Unavailable',{status:503}),
  env,{status:'ERROR',scanned:0});
 assert.deepEqual(failed,{saved:false,reason:'AUDIT_FAILED'});
});
test('Cloudflare Cron writes one append-only scan audit while leaving publication disabled',async()=>{
 const {createAutoScanner}=await scannerModule;
 const candles=Array.from({length:330},(_,i)=>{
  const first=Math.floor((NOW-8*60000)/3600000)*3600000-329*3600000;
  const at=first+i*3600000;
  const close=100+.06*i+Math.sin(i*1.25)*.38;
  const open=i?100+.06*(i-1)+Math.sin((i-1)*1.25)*.38:close-.12;
  return [at,String(open),String(Math.max(open,close)+.16),
   String(Math.min(open,close)-.16),String(close),'100',at+3600000-1];
 });
 let wrote=0,fetched=0;
 const fetchFn=async(url,opts)=>{
  if(url.includes('/fapi/v1/klines?')){fetched++;return new Response(JSON.stringify(candles))}
  if(url.includes('/fapi/v1/ticker/price?')){
   fetched++;return new Response(JSON.stringify({symbol:'BTCUSDT',price:String(candles.at(-2)[4])}))
  }
  if(url.endsWith('/rpc/sc_record_auto_scan')){
   wrote++;const data=JSON.parse(opts.body);
   assert.equal(data.p_published,0);
   assert.equal(data.p_qualified,1);
   assert.equal(data.p_status,'COMPLETED');
   assert.equal(opts.headers.apikey,secret);
   return new Response(null,{status:204});
  }
  throw Error('Unknown target');
 };
 const scanner=createAutoScanner({fetchFn,now:()=>NOW,
  researchHandler:async()=>new Response(JSON.stringify({
   coverage:'FULL_WEEK',checkedAt:new Date(NOW).toISOString(),events:[]
  })),cryptoSymbols:['BTCUSDT'],forexSymbols:[]});
 const run=await scanner.scheduled(env);
 assert.equal(run.status,'SCAN_COMPLETED');
 assert.equal(run.published,0);
 assert.equal(run.qualified,1);
 assert.equal(run.auditSaved,true);
 assert.equal(wrote,1);assert.equal(fetched,2);
});
