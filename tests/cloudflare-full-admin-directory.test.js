'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');
test('Superadmin directory covers verified authentication records, even without profiles',()=>{
 const sql=read('database/sc-admin-member-directory.sql'),worker=read('cloudflare/worker.mjs');
 assert.match(sql,/FROM auth\.users a/);
 assert.match(sql,/LEFT JOIN public\.sc_member_profiles m/);
 assert.match(sql,/PERFORM public\.sc_check_private_admin\(p_actor\)/);
 assert.match(worker,/rpc\/sc_admin_member_directory/);
 assert.match(worker,/emailVerified:p\.emailVerified/);
 assert.match(worker,/hasProfile:p\.hasProfile/);
});
test('Unlinked user reconciliation never grants trial or paid subscription',()=>{
 const sql=read('database/sc-admin-member-directory.sql'),worker=read('cloudflare/worker.mjs'),js=read('ops-console.js');
 assert.match(sql,/a\.email_confirmed_at IS NOT NULL/);
 assert.match(sql,/ON CONFLICT\(user_id\) DO NOTHING/);
 assert.match(sql,/profile_reconcile/);
 assert.doesNotMatch(sql,/INSERT INTO public\.sc_paid_access|INSERT INTO public\.sc_trials/);
 assert.match(worker,/rpc\/sc_admin_reconcile_member/);
 assert.match(worker,/paidAccessGranted:false,trialGranted:false/);
 assert.match(js,/function reconcileProfile/);
 assert.match(js,/Show all/);
});
