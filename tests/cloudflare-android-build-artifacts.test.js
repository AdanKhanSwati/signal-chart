'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const workflow=fs.readFileSync(path.join(__dirname,'..','.github/workflows/signalchart-android.yml'),'utf8');
test('Customer and admin Android QA builds run for current Cloudflare migration branch',()=>{
 assert.match(workflow,/branches:\s*\[signalchart-android-landing, signalchart-cloudflare-free-migration\]/);
 assert.match(workflow,/testCustomerDebugUnitTest testAdminDebugUnitTest lintCustomerDebug lintAdminDebug assembleCustomerDebug assembleAdminDebug/);
});
test('Customer and super-admin debug install packages are separately downloadable',()=>{
 assert.match(workflow,/name: signalchart-customer-debug-apk/);
 assert.match(workflow,/name: signalchart-superadmin-debug-apk/);
 assert.match(workflow,/path: mobile\/android\/app\/build\/outputs\/apk\/customer\/debug\/\*\.apk/);
 assert.match(workflow,/path: mobile\/android\/app\/build\/outputs\/apk\/admin\/debug\/\*\.apk/);
 assert.match(workflow,/retention-days: 30/);
});
test('Android release uses verified build pipeline without auto-publishing to Play Store',()=>{
 assert.doesNotMatch(workflow,/playstore|google-play|publish-to-play|deploy-to-play/i);
 assert.match(workflow,/bundleCustomerRelease bundleAdminRelease/);
});
