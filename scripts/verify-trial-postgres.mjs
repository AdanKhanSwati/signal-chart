#!/usr/bin/env node
/* Optional isolated PostgreSQL-compatible smoke test.
 * Run ONLY in disposable test environment:
 *   npm install --no-save @electric-sql/pglite@0.5.15
 *   node scripts/verify-trial-postgres.mjs
 * Never uses production Supabase credentials.
 */
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const U1='11111111-1111-4111-8111-111111111111';
const U2='22222222-2222-4222-8222-222222222222';
const ADMIN='33333333-3333-4333-8333-333333333333';
const HASH='a'.repeat(64);
let passed=0;
const check=(expression,label)=>{assert.ok(expression,label);passed++;console.log('PASS',label)};
const query=async(sql,params=[])=>{const r=await db.query(sql,params);return r.rows[0]};
try{
 await db.exec('create schema auth;create table auth.users(id uuid primary key,email text);create role anon;create role authenticated;create role service_role;');
 const paths=[
  '20261109180000_sc_trial_foundation.sql',
  '20261109180100_sc_trial_functions.sql',
  '20261109180200_sc_trial_admin.sql',
  '20261109180300_sc_legacy_guard.sql'];
 for(const path of paths){
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+path,import.meta.url),'utf8'));
  check(true,'migration applied: '+path);
 }
 const rls=await db.query("select tablename,rowsecurity from pg_tables where tablename like 'sc_%'");
 check(rls.rows.length===10&&rls.rows.every(x=>x.rowsecurity),'all 10 tables enable RLS');
 await query('insert into auth.users(id,email) values ($1,$2),($3,$4),($5,$6)',[
  U1,'one@example.test',U2,'two@example.test',ADMIN,'admin@example.test']);
 const first=await query('select public.sc_activate_trial($1,$2,now()) as v',[U1,HASH]);
 check(first.v.result==='activated','verified customer activates 72-hour trial');
 const repeat=await query('select public.sc_activate_trial($1,$2,now()) as v',[U1,HASH]);
 check(repeat.v.result==='existing_trial','reusing same account cannot reset trial');
 const duplicate=await query('select public.sc_activate_trial($1,$2,now()) as v',[U2,HASH]);
 check(duplicate.v.result==='already_used','second email with same verified phone denied');
 for(const [key,market] of [
  ['crypto:btc:first','crypto'],['forex:eur:second','forex'],
  ['crypto:eth:third','crypto'],['forex:gbp:fourth','forex']
 ]){
  await query('insert into public.sc_premium_signals(signal_key,market,asset,premium_data) values($1,$2,$3,$4::jsonb)',
   [key,market,market==='crypto'?'BTCUSDT':'EURUSD',JSON.stringify({direction:'BUY',entry:123,stopLoss:120,takeProfit:127})]);
 }
 const listing=await query('select public.sc_signal_public_list(null,50) as v');
 check(!JSON.stringify(listing.v).includes('direction')&&!JSON.stringify(listing.v).includes('stopLoss'),
  'public previews contain no actionable details');
 const unlock=key=>query('select public.sc_unlock_trial($1,$2) as v',[U1,key]);
 const a=await unlock('crypto:btc:first');
 check(a.v.allowed&&a.v.signalsRemaining===2,'first crypto unlock leaves two');
 const a2=await unlock('crypto:btc:first');
 check(a2.v.allowed&&a2.v.signalsRemaining===2,'reopen before exhaustion costs no credit');
 const b=await unlock('forex:eur:second');
 check(b.v.allowed&&b.v.signalsRemaining===1,'second forex unlock leaves one');
 const c=await unlock('crypto:eth:third');
 check(c.v.allowed&&c.v.signalsRemaining===0&&c.v.trialExhausted,'third unlock exhausts allowance');
 const d=await unlock('forex:gbp:fourth');
 check(!d.v.allowed&&d.v.reason==='trial_exhausted','fourth unlock denied');
 check(!(await unlock('crypto:btc:first')).v.allowed,'exhausted trial cannot reopen premium details');
 const n=await query('select count(*)::int n from public.sc_trial_signal_unlocks');
 check(n.n===3,'only three immutable unlock events');
 const noPaid=await query('select public.sc_paid_signal($1,$2) as v',[U1,'crypto:btc:first']);
 check(noPaid.v.allowed===false,'trial does not forge paid entitlement');
 const paid=await query('select public.sc_register_paid_access($1,$2,$3,now()) as v',
  [U1,'verified-payment-123456',ADMIN]);
 check(paid.v.result==='recorded','verified admin payment creates paid membership');
 const canPaid=await query('select public.sc_paid_signal($1,$2) as v',[U1,'crypto:btc:first']);
 check(canPaid.v.allowed===true,'paid status overrides exhausted trial');
 const paidRepeat=await query('select public.sc_register_paid_access($1,$2,$3,now()) as v',
  [U1,'verified-payment-123456',ADMIN]);
 check(paidRepeat.v.result==='already_recorded','duplicate payment cannot extend membership');
 const except=await query("select public.sc_admin_trial_action($1,'exception',$2,$3,$4,now()+interval '1 day') as v",
  [ADMIN,U2,HASH,'Verified recycled-phone exception']);
 check(except.v.result==='exception_created','admin exception is auditable');
 const second=await query('select public.sc_activate_trial($1,$2,now()) as v',[U2,HASH]);
 check(second.v.result==='activated','reassigned phone exception allows new trial');
 const analytics=await query('select public.sc_admin_trial_analytics() as v');
 check(analytics.v.trialActivations===2&&analytics.v.paidConversions===1,'analytics use actual database rows');
 const network='b'.repeat(64);
 for(let i=0;i<5;i++)await query("select public.sc_otp_rate_check($1,$2,$3,null,'failed')",[U1,HASH,network]);
 const limit=await query("select public.sc_otp_rate_check($1,$2,$3,null,'verify_check') as v",[U1,HASH,network]);
 check(limit.v.allowed===false,'too many OTP failures block verification');
 try{
  await db.exec('set role authenticated;select * from public.sc_premium_signals');
  throw Error('Unauthorized direct premium SELECT unexpectedly succeeded');
 }catch(e){
  check(/permission denied/i.test(e.message),'authenticated client cannot SELECT premium table');
 }
 console.log('SMOKE_TEST_PASSED',passed);
}catch(e){
 console.error('SMOKE_TEST_FAILED',e.stack||e);
 process.exitCode=1;
}finally{await db.close()}
