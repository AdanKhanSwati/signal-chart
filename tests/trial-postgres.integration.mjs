import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const migrations=['20261109180000_sc_trial_foundation.sql','20261109180100_sc_trial_functions.sql',
'20261109180200_sc_trial_admin.sql','20261109180300_sc_legacy_guard.sql',
'20261109190000_sc_trial_reopen.sql'];
const customer1='11111111-1111-4111-8111-111111111111';
const customer2='22222222-2222-4222-8222-222222222222';
const admin='33333333-3333-4333-8333-333333333333';
const phoneHash='a'.repeat(64);
async function install(db){
 await db.exec('create schema auth; create table auth.users(id uuid primary key, email text); create role anon; create role authenticated; create role service_role;');
 for(const filename of migrations){
  const sql=await fs.readFile(path.join(base,'supabase/migrations',filename),'utf8');
  await db.exec(sql);
 }
 for(const [id,email] of [[customer1,'first@test.example'],[customer2,'second@test.example'],[admin,'admin@test.example']])
  await db.query('insert into auth.users(id,email) values ($1,$2)',[id,email]);
}
const first=(await async function(){return new PGlite()}());
test('SignalChart trial migrations and security rules execute on real PostgreSQL engine',async t=>{
 const db=first;await install(db);
 t.after(async()=>db.close());
 const active=(await db.query('select public.sc_activate_trial($1,$2,now()) x',[customer1,phoneHash])).rows[0].x;
 assert.equal(active.result,'activated');
 assert.equal(active.trial.signalsRemaining,3);
 assert.equal(new Date(active.trial.expiresAt)-new Date(active.trial.activatedAt),72*3600000);
 const duplicate=(await db.query('select public.sc_activate_trial($1,$2,now()) x',[customer2,phoneHash])).rows[0].x;
 assert.equal(duplicate.result,'already_used');
 assert.ok(!JSON.stringify(duplicate).includes('first@test.example'));
 const repeated=(await db.query('select public.sc_activate_trial($1,$2,now()) x',[customer1,phoneHash])).rows[0].x;
 assert.equal(repeated.result,'existing_trial');
 for(let i=1;i<=6;i++){
  const key='SETUP'+i,market=i%2?'forex':'crypto';
  await db.query('insert into public.sc_premium_signals(signal_key,market,asset,premium_data) values ($1,$2,$3,$4::jsonb)',[
   key,market,key,JSON.stringify({entry:102.5,stopLoss:100,takeProfit:107,direction:'BUY'})]);
 }
 const preview=(await db.query('select public.sc_signal_public_list(null,100) x')).rows[0].x;
 assert.equal(preview.length,6);
 assert.ok(preview.every(x=>!JSON.stringify(x).includes('stopLoss')&&!JSON.stringify(x).includes('direction')));
 const unlock=async key=>(await db.query('select public.sc_unlock_trial($1,$2) x',[customer1,key])).rows[0].x;
 assert.equal((await unlock('SETUP1')).signalsRemaining,2);
 const again=await unlock('SETUP1');
 assert.equal(again.reason,'previously_unlocked');
 assert.equal(again.signalsRemaining,2);
 assert.equal((await unlock('SETUP2')).signalsRemaining,1);
 assert.equal((await unlock('SETUP3')).signalsRemaining,0);
 const failed=await Promise.all(['SETUP4','SETUP5','SETUP6'].map(unlock));
 assert.ok(failed.every(x=>x.allowed===false&&x.reason==='trial_exhausted'));
 const count=(await db.query('select signals_consumed from public.sc_trials where user_id=$1',[customer1])).rows[0].signals_consumed;
 assert.equal(count,3);
 const reopened=await unlock('SETUP1');
 assert.equal(reopened.allowed,true,'previously unlocked signals remain readable during the active trial');
 assert.equal(reopened.reason,'previously_unlocked');
 assert.equal(reopened.signalsUsed,3);
 assert.equal(reopened.signalsRemaining,0);
 assert.equal((await unlock('SETUP3')).reason,'previously_unlocked');
 const state=(await db.query('select public.sc_trial_state($1) x',[customer1])).rows[0].x;
 assert.equal(state.trialStatus,'exhausted');
 const user2=(await db.query('select public.sc_trial_state($1) x',[customer2])).rows[0].x;
 assert.equal(user2.trialStatus,'not_activated');
 const paid=(await db.query('select public.sc_register_paid_access($1,$2,$3,now()) x',[customer1,'verified-payment-1',admin])).rows[0].x;
 assert.equal(paid.result,'recorded');
 assert.equal((await db.query('select public.sc_paid_signal($1,$2) x',[customer1,'SETUP4'])).rows[0].x.allowed,true);
 assert.equal((await db.query('select public.sc_register_paid_access($1,$2,$3,now()) x',[customer1,'verified-payment-1',admin])).rows[0].x.result,'already_recorded');
 // Ensure service-only tables/RPC cannot be read/called as a normal Supabase user.
 await db.exec('set role authenticated;');
 try{
  await assert.rejects(db.query('select * from public.sc_premium_signals'),/permission denied/);
  await assert.rejects(db.query('select public.sc_unlock_trial($1,$2)',[customer1,'SETUP6']),/permission denied/);
 }finally{await db.exec('reset role;')}
 // Mark 72 hours elapsed while maintaining the exactly-72h schema constraint.
 await db.query("update public.sc_trials set activated_at=now()-interval '73 hours', expires_at=now()-interval '1 hour' where user_id=$1",[customer1]);
 assert.equal((await db.query('select public.sc_trial_state($1) x',[customer1])).rows[0].x.trialStatus,'expired');
 assert.equal((await unlock('SETUP6')).reason,'trial_expired');
 assert.equal((await unlock('SETUP1')).reason,'trial_expired','previously unlocked signals must lock after the trial term');
 assert.equal((await db.query('select public.sc_paid_signal($1,$2) x',[customer1,'SETUP6'])).rows[0].x.allowed,true);
 // Consume a different old account's trial history via audit hold, rather than silently issuing a new trial.
 await db.query('insert into public.sc_legacy_trial_holds(user_id,source,reason) values ($1,$2,$3)',[
 customer2,'legacy_blob_trial','Recorded previously used legacy trial']);
 const held=(await db.query('select public.sc_activate_trial($1,$2,now()) x',[customer2,'b'.repeat(64)])).rows[0].x;
 assert.equal(held.result,'legacy_review_required');
});
