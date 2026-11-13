'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {statements} = require('../mobile/android/assetlinks.cjs');
const fingerprint = Array(32).fill('AB').join(':');
test('Android association preserves both actual package/certificate pairs', () => {
  const result = statements(['pro.signalchart.app', fingerprint, 'pro.signalchart.app.admin', fingerprint.toLowerCase()]);
  assert.equal(result.length, 2);
  assert.equal(result[1].target.package_name, 'pro.signalchart.app.admin');
  assert.deepEqual(result[1].target.sha256_cert_fingerprints, [fingerprint]);
});
test('Android association refuses absent, malformed or duplicate trust identities', () => {
  for (const args of [[], ['pro.signalchart.app'], ['other.app', fingerprint], ['pro.signalchart.app', 'TODO'],
    ['pro.signalchart.app', fingerprint, 'pro.signalchart.app', fingerprint]]) assert.throws(() => statements(args));
});
