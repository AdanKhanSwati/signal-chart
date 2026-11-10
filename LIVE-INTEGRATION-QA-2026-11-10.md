# SignalChart — Live integration verification (2026-11-10)

**Result: PARTIALLY VERIFIED. Do not release to paying customers.**

## Real external-service checks completed

### Vercel private Blob storage — PASS

A Vercel Sandbox executed the reconstructed `lib/candriva-core.js` adapter against the connected private Blob store using temporary files under an isolated `sc-qa-autocleanup/<random-uuid>/` prefix. Checks passed for JSON write, JSON read, JSON record listing, immutable overwrite rejection, binary PNG write and binary read. Both temporary objects were removed successfully (2 of 2).

### Real Supabase PostgreSQL trial transaction — PASS

A single **BEGIN / ROLLBACK** transaction inserted two synthetic Auth users and four synthetic crypto premium signals, then exercised the deployed SQL functions. Assertions passed for:
- New user trial activation with exactly 72 hours and three unlocks
- A second user being denied a trial with the same phone identity
- Three distinct signal unlocks increasing consumption to 3
- Fourth unique signal denied
- Reopening an already-unlocked signal during the trial
- Exhausted-state reporting
- Public preview metadata omitting private entry, stop and premium payload fields

After rollback, verified **zero synthetic users, zero synthetic signals, zero real trial rows and zero phone claim rows** remain.

### Real Supabase Auth API — PASS (negative authorization only)

Using the project's public Supabase URL and publishable key, confirmed the reconstructed `core.identity` rejects:
- Missing Authorization bearer
- Forged JWT sent to Supabase Auth over HTTPS

No test user passwords, production users or private server API keys were read.

### SQL privileged-function access — PASS

Verified that `anon` and `authenticated` roles have no EXECUTE access to ten privileged `sc_*` functions including trial activation, signal unlock, paid-access registration and automatic publication. Service role retains the needed permissions.

### Local-regression + optional external QA script — PASS

Full latest isolated suite: **134 passed, 0 failed**. Verified `scripts/live-integration-smoke.cjs` syntax and live negative-Auth mode. The optional Blob mode is off by default, avoids secrets in output, writes only disposable test data, and cleans up files. The real Blob check was separately completed as noted above.

## Open issues

1. **Real verified-user end-to-end flows not yet tested:** Sign-in, verification-channel delivery, customer session to membership API, premium unlock through the browser, payment submission and admin review require a dedicated verified test identity and secure browser access. Never use real customer accounts to impersonate, change subscriptions, or consume credits.
2. **Member adapter persistence check needs diagnosis:** A separate temporary synthetic member probe returned a locked/no-trial account as expected but failed an additional strict Blob persistence assertion. The temporary member record was cleaned. Do not classify customer registration as fully verified yet.
3. **Original source recovery:** 93 of 104 source files are byte-verified. The other 11 are reconstructed equivalents; release-check remains intentionally BLOCKED.
4. **Phone delivery:** Preview WhatsApp OTP delivery remains disabled; no live provider-side delivery proof.
5. **Automatic signals:** Supabase hourly scheduled job and database automatic-publishing flag remain disabled; no real validated signal performance.
6. **Supabase Auth security advisor:** leaked-password protection is not enabled. Review [Auth password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) before accepting users.
7. **Billing:** Staging payment collection and legacy signal publishing remain disabled; no live Bitcoin payment or credit grant was simulated.

## Production safety

Staging Vercel deployment from previous milestone: `dpl_8poTM63DJs9p9VGykNQRJFLwcXri` remains READY; no new Vercel deployment from these tests and no production promotion. The permanent Supabase Auth/phone/payment ledger remains unmodified by the SQL transaction.

**Next release engineering task:** Resolve the member persistence assertion, then run end-to-end HTTP tests using dedicated verified QA credentials stored in the execution environment (never in source or chat), and independently verify payment/OTP provider flows before commercial launch.
