'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const text = fs.readFileSync(path.join(__dirname,'../.github/workflows/cloudflare-staging-deploy.yml'),'utf8');

test('Staging deployment runs on reviewed branch push and offers optional dispatch',()=>{
 assert.match(text,/workflow_dispatch:/);
 assert.match(text,/push:\s*\n\s*branches:\s*\n\s*- signalchart-cloudflare-free-migration/);
 assert.match(text,/github\.ref == 'refs\/heads\/signalchart-cloudflare-free-migration'/);
 assert.match(text,/concurrency:/);
});
test('Release safeguards verify staging-only config and never target custom domain',()=>{
 assert.match(text,/wrangler\.routes \|\| wrangler\.route/);
 assert.match(text,/SC_AUTO_PUBLISH_ENABLED !== 'false'/);
 assert.match(text,/customerPaymentCollectionAvailable:false/);
 assert.match(text,/--config cloudflare\/wrangler\.staging\.json/);
 assert.doesNotMatch(text,/--env production|signalchart\.pro/);
});
test('Deploy requires GitHub secrets, runs tests and builds public asset allowlist',()=>{
 assert.match(text,/secrets\.CLOUDFLARE_API_TOKEN/);
 assert.match(text,/secrets\.CLOUDFLARE_ACCOUNT_ID/);
 assert.match(text,/node --test tests\/\*\.test\.js/);
 assert.match(text,/node scripts\/build-cloudflare-static\.cjs/);
 assert.match(text,/check-live-staging\.cjs/);
 assert.doesNotMatch(text,/echo.*\$CF_TOKEN/);
});
