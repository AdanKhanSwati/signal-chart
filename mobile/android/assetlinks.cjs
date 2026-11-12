'use strict';
// Generates association JSON from actual public certificate fingerprints only.
function statements(args) {
  if (!args.length || args.length % 2) throw Error('Provide package/fingerprint pairs');
  const seen = new Set();
  return Array.from({length: args.length / 2}, (_, i) => {
    const packageName = args[i * 2], fingerprint = args[i * 2 + 1].toUpperCase();
    if (!/^pro\.signalchart\.app(?:\.admin)?(?:\.debug)?$/.test(packageName)) throw Error('Unexpected application ID');
    if (!/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(fingerprint)) throw Error('Expected colon-separated SHA-256 signing fingerprint');
    if (seen.has(packageName)) throw Error('Duplicate application ID');
    seen.add(packageName);
    return {relation: ['delegate_permission/common.handle_all_urls'], target: {
      namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: [fingerprint]
    }};
  });
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(statements(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {statements};
