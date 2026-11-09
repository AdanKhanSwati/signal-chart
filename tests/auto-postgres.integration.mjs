import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const migrations=[
 '20261109180000_sc_trial_foundation.sql',
 '20261109180100_sc_trial_functions.sql',
 '20261109180200_sc_trial_admin.sql',
 '20261109180300_sc_legacy_guard.sql',
 '20261109190000_sc_trial_reopen.sql',
 '20261109191000_sc_signal_publication_review.sql',
 '20261109192000_sc_signal_review_queue.sql',
 '20261109193000_sc_premium_signal_freshness.sql',
 '20261109194000_sc_automatic_publication.sql'
];
const actor='55555555-5555-4555-8555-555555555555';
async function install(db){
 await db.exec('create schema auth; create table auth.users(id uuid primary key,email text); create role anon; create role authenticated; create role service_role;');
 for(const f of migrations){
  await db.exec(await fs.readFile(path.join(dir,'supabase/migrations',f),'utf8'));
 }
 await db.query('insert into auth.users(id,email) values($1,$2)',[actor,'system@testing.invalid']);
}
const candidate=(key,at)=>({
 key,at,analysis:{
  direction:'LONG',entry:100,stopLoss:98,takeProfit:104,riskPercent:0.5,
  timeframe:'1h',riskReward:2,executionBasis:'EXCHANGE_FUTURES_REFERENCE',
  strategy:'sc-hourly-ema-breakout-v1',auditStatus:'UNVERIFIED_LIVE_PERFORMANCE',
  newsCoverage:'FULL_WEEK',newsDecision:'CLEAR',
  research:'Verified completed candles confirm a strict bullish trend, momentum, volatility and breakout setup. Economic events are verified clear. This is historical research and not an assured outcome.',
  evidenceUrl:'https://www.binance.com/en/futures/BTCUSDT',
  indicators:{signalScore:8.5,atrPercent:1.0}
 }
});
test('automatic publication is disabled by default, protects all customer roles and caps duplicates',async t=>{
 const db=new PGlite();t.after(()=>db.close());await install(db);
 const now=Date.now(),closed=new Date(now-8*60000).toISOString(),key='crypto:BTCUSDT:'+Date.parse(closed)+':long';
 const c=candidate(key,closed);
 async function call(obj=c){
  const result=(await db.query('select public.sc_publish_automatic_signal($1,$2,$3,$4,$5,$6::jsonb) x',
   [obj.key,'crypto',obj.key.split(':')[1],'Binance USD-M Futures',obj.at,JSON.stringify(obj.analysis)])).rows[0].x;
  return result;
 }
 const denied=await call();
 assert.equal(denied.published,false);
 assert.equal(denied.reason,'automation_disabled');
 assert.equal((await db.query('select count(*) n from public.sc_premium_signals')).rows[0].n,0);
 await db.exec('set role authenticated;');
 try{
  await assert.rejects(db.query('select * from public.sc_auto_signal_control'),/permission denied/);
  await assert.rejects(db.query('select * from public.sc_auto_scan_runs'),/permission denied/);
  await assert.rejects(db.query('select public.sc_publish_automatic_signal($1,$2,$3,$4,$5,$6::jsonb)',[
   key,'crypto','BTCUSDT','Binance USD-M Futures',closed,JSON.stringify(c.analysis)]),/permission denied/);
 }finally{await db.exec('reset role;')}
 await db.exec("update public.sc_auto_signal_control set enabled=true where key='global'");
 const ok=await call();
 assert.equal(ok.published,true);
 assert.equal(ok.reason,'automated_rules_passed');
 assert.equal((await call()).reason,'duplicate');
 const other=candidate('crypto:BTCUSDT:'+(Date.parse(closed)+60000)+':long',new Date(Date.parse(closed)+60000).toISOString());
 assert.equal((await call(other)).reason,'existing_live_signal');
 assert.equal((await db.query('select public.sc_signal_public_list($1,$2) x',['crypto',50])).rows[0].x.length,1);
 const invalid={...c,analysis:{...c.analysis,newsCoverage:'UNKNOWN'}};
 await assert.rejects(call({...invalid,key:'crypto:ETHUSDT:'+Date.parse(closed)+':long'}),/Research or news safety/);
 assert.equal((await db.query("select count(*) n from public.sc_premium_signals")).rows[0].n,1);
 assert.equal((await db.query("select public.sc_paid_signal($1,$2) x",[
  actor,key])).rows[0].x.allowed,false);
 await db.query("select public.sc_record_auto_scan($1,$2,$3,$4,$5,$6::jsonb)",[
  'COMPLETED',8,1,1,0,JSON.stringify({strategy:'sc-hourly-ema-breakout-v1'})]);
 assert.equal((await db.query('select count(*) n from public.sc_auto_scan_runs')).rows[0].n,1);
});
