'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','supabase','migrations');
const schema=fs.readFileSync(path.join(root,'20261109180000_sc_trial_foundation.sql'),'utf8');
const fn=fs.readFileSync(path.join(root,'20261109180100_sc_trial_functions.sql'),'utf8');
test('phone identity claim and per-user trial are unique',()=>{
 assert.match(schema,/phone_hash text primary key/);
 assert.match(schema,/user_id uuid not null unique references auth\.users\(id\)/);
 assert.match(schema,/primary key \(trial_id,signal_key\)/);
});
test('trial is exactly 72 hours and limited to three unique signals',()=>{
 assert.match(schema,/check\(signals_consumed between 0 and 3\)/);
 assert.match(schema,/interval '72 hours'/);
 assert.match(fn,/where user_id=p_user for update/);
 assert.match(fn,/if t\.signals_consumed>=3 then/);
});
test('sensitive tables deny direct authenticated access',()=>{
 assert.match(schema,/enable row level security/g);
 assert.match(schema,/from anon,authenticated/);
 assert.match(fn,/revoke all on function public\.sc_unlock_trial.*from public,anon,authenticated/);
 assert.match(fn,/grant execute on function public\.sc_unlock_trial.*to service_role/);
});
test('public signal list cannot include private signal payload',()=>{
 const begin=fn.indexOf('function public.sc_signal_public_list'),end=fn.indexOf('function public.sc_paid_signal');
 const content=fn.slice(begin,end);
 assert.ok(!content.includes("'data',s.premium_data"));
 assert.ok(!content.includes("'metadata',z.public_meta"));
});
test('OTP rate limiting and risk tracking are server-recorded',()=>{
 assert.match(fn,/sc_otp_rate_check/);
 assert.match(fn,/otp_verify_failed/);
 assert.match(schema,/network_hash text/);
});
