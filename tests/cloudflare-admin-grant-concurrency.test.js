'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8');
test('Private SQL migration serializes concurrent grants to the same member',()=>{
 const migration=read('database/sc-admin-grant-concurrency.sql');
 assert.match(migration,/CREATE OR REPLACE FUNCTION public.sc_admin_access_grant/);
 assert.match(migration,/pg_advisory_xact_lock/);
 assert.match(migration,/hashtextextended\(p_user::text,0\)/);
 assert.match(migration,/An active complimentary grant already exists/);
 assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM|TRUNCATE/i);
});
test('Two new admin routes are covered by read-only anonymous denial smoke',()=>{
 const src=read('scripts/check-live-staging.cjs');
 assert.match(src,/adminPaymentsGuard/);
 assert.match(src,/adminMembersGuard/);
 assert.match(src,/expected:401,type:'adminGuard'/);
 assert.doesNotMatch(src,/submit_payment|review_payment|grant_access\(/);
});
