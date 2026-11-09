# Supabase migration and launch readiness — SignalChart

## Migration status (2026-11-09; verified with connected Supabase)
The four additive SQL migrations have now been **applied successfully** to the existing Supabase project `nnailvcgaupjtdaxvjsx` (named candriva), via the connected Supabase migration interface. The Supabase migration history now records:

- `20261109140249` — `signalchart_trial_foundation_20261109`
- `20261109140253` — `signalchart_trial_functions_20261109`
- `20261109140257` — `signalchart_trial_admin_20261109`
- `20261109140300` — `signalchart_trial_legacy_guard_20261109`

**Post-application read-only checks:** 10 new public application tables / 10 enabled RLS; 13 privileged `sc_*` functions with zero `anon` or `authenticated` EXECUTE privileges; zero publicly selectable SignalChart trial tables. Existing auth users: 1, phone-verified: 0. One existing user created before the rollout was conservatively inserted into `sc_legacy_trial_holds` with `source=legacy_manual_review`, preserving their account without granting a repeat trial. New trial records, unlocks, paid access records and SignalChart premium signals: all **0**.

The trial cutoff `SC_TRIAL_ROLLOUT_AT=2026-11-09T14:03:00.000Z` has been configured for the **Vercel staging preview branch only**. It is not a production environment change. The database itself is now configured; **live Auth OTP, the server-side privileged credential, the HMAC secret, premium signal ingestion and real-user application requests are not configured or tested yet**.

The migrations were applied successfully to disposable PGlite/PostgreSQL-compatible test databases. This validates SQL syntax and simulated rules, not production Supabase Auth and Row Level Security under live traffic.

## Inspect before applying (read-only)
Check actual existing auth schema, user accounts, policies and subscribed members first:
- Table names and indexes in \`public\`, \`auth\`, and \`storage\`
- Any prior trial usage in Vercel Blob under \`cv2/members/\` and older subscription stores
- Verified BTC payment approvals, administrator grants, account IDs
- Existing RLS policies and Supabase Auth phone settings
- Whether private Vercel Blob and admin email are correctly configured

The new \`public.sc_*\` tables do not drop, truncate or overwrite older records.
Do **not** import historical free-trial timestamps as fresh promotional trials.

## Before switching on trial activation
- Configure \`SUPABASE_SECRET_KEY\` (preferred \`sb_secret_...\`) **server-side only**; legacy \`SUPABASE_SERVICE_ROLE_KEY\` JWT also works. Never expose either in client JavaScript or GitHub. The new secret key is sent only in the \`apikey\` header, not as a Bearer JWT.
- Configure a long randomly generated \`SC_TRIAL_HMAC_SECRET\` (at least 32 characters). Securely back up this key; changing it without a planned hash migration can permit repeated claims.
- Set \`SC_TRIAL_ROLLOUT_AT\` to the actual UTC cutover timestamp **after** completing the historical-user migration. Older accounts require admin review/exception even if prior Blob data is incomplete.
- Keep \`SUPABASE_URL\`, \`SUPABASE_PUBLISHABLE_KEY\`, verified JWT authentication and \`CANDRIVA_ADMIN_EMAIL\`.
- Configure Supabase Auth phone provider with Twilio/Twilio Verify and an approved WhatsApp sender, phone/IP quotas, CAPTCHA, resend and region restrictions. WhatsApp verification may cost money; obtain owner approval before enabling. No SMS fallback is implemented.
- Populate \`sc_legacy_trial_holds\` for known prior trial users, and review phone reassignment exceptions before granting more trial access.
- Populate \`sc_premium_signals\` with server-only premium signal details after validating sources; never use an unverified browser-side object as premium signal source.
- Enable the actual Vercel preview environment with payment collection OFF and without promoting its preview to production.
- Inspect the next available deployment budget; avoid exceeding the self-imposed five assistant deployments per rolling 24 hours.

## Account migration decision
- Existing paid memberships and approved manual payments remain valid through the existing Blob authorization path. Mirror them to \`sc_paid_access\` **idempotently** using admin-only \`sync_approved\` after migration, preserving original dates and preventing double-extension.
- Existing users with known historical trial records are NOT granted another trial automatically.
- Existing users without a confirmed phone can use free platform features and paid membership. They need verified SMS to request any new promotional trial.
- Existing users created before \`SC_TRIAL_ROLLOUT_AT\` are held for review unless a one-time audited admin exception is issued.
- On suspected recycled phone numbers, the admin investigates ownership, logs a reason and issues a time-limited exception for that verified identity. Earlier customers stay unaffected.

## Security model
No direct \`anon\` or \`authenticated\` grants on SignalChart trial tables or functions. Only the server-side service role invokes RLS-protected functions through authenticated API routes.
The signal preview lists only signal key, market, asset and timestamp. Premium direction, entry, target, stop, explanation and other trade fields are returned only from a server-authorized explicit POST.
The third unique trial unlock returns the third signal once, marks the trial exhausted and blocks subsequent premium access. Earlier reopened signals consume no extra credit while the trial is not exhausted.
Shared Wi-Fi and VPN usage are advisory risk signals, not automatic bans. OTP requests are restricted by per-number rate checks, and verification attempts are restricted after repeated failures.

## Android
No complete Android Studio customer or Super Admin source project has been recovered in the current GitHub repository or accessible file searches. The shared REST endpoints can be used by the same verified Supabase account, but Play Integrity token verification and actual Android client integration remain unimplemented/unverified.
Google Play distribution of digital subscription products must follow the applicable Play payments policies; do not enable the manual BTC purchase UI inside a Play-distributed app without policy review.

## Reproducible isolated database tests
In a disposable test clone, run:
\`npm install --no-save @electric-sql/pglite@0.5.15\`
\`node scripts/verify-trial-postgres.mjs\`
This installs a testing dependency locally only. It does not mutate production or commit secrets.

## External blockers
1. Supabase inspection and migration execution are complete. Still required: Vercel preview-only server-side database secret and protected HMAC key, plus live API endpoint verification.
2. WhatsApp-capable provider must be configured and tested with real international numbers before WhatsApp OTP can be claimed operational. No paid verification provider is configured currently.
3. Real user/admin JWT, row-security and concurrent Postgres requests need staging end-to-end tests.
4. Android project source and Play Integrity credentials are not available.
5. Signal/news/research and forex engine source recovery remain incomplete; do not promote the staging branch into production.

**Do not claim a 100% secure launch until the external checks have passed.**

## Isolated verification (2026-11-09, latest)

- **79/79** JavaScript regression/security tests passed (the old Forex source integration test is intentionally excluded because the original market engine is not recovered).
- The disposable PostgreSQL-compatible PGlite suite passed **30/30** additional behavioral checks: phone claim uniqueness, 72-hour activation, unique crypto/forex unlocks, exhaustion, expiry, paid conversion, RLS-denied direct selects, risk rate checks and historical-account holds.
- The separate executable PostgreSQL integration test **tests/trial-postgres.integration.mjs passed** using an isolated PGlite engine. This does **not** establish live Supabase RLS or independent database-connection race testing.
- The public premium-signal listing now strips privileged fields at the HTTP API boundary even if upstream data accidentally contains them. See **tests/premium-preview-sanitization.test.js**.
- Both modern `SUPABASE_SECRET_KEY` and older JWT `SUPABASE_SERVICE_ROLE_KEY` are supported with regression tests; do not configure both unless transitioning intentionally.

## Cutover blockers — strict

1. Read and compare **actual** Supabase auth/user/payment schema, live RLS and previous accounts before applying any additive migration. Do **not** execute unreviewed SQL solely because isolated tests pass.
2. Verify the correct Supabase project ID, enable an **approved and funded** WhatsApp OTP provider only after owner authorization, and run real OTP sends and failed-attempt tests.
3. Back up and preserve `SC_TRIAL_HMAC_SECRET` securely. A different key would yield different trial identity hashes and could permit repeat claims.
4. Set `SC_TRIAL_ROLLOUT_AT` only after importing documented legacy trial holders; never silently give prior trial users new promotional access.
5. End-to-end tests must use verified customer/admin sessions and include a second email with the same verified phone, simultaneous unlocks from independent DB connections, trial expiration and an approved manual-payment conversion.
6. No Android source/Play Integrity integration is present in this repository; Android app release status remains **not implemented/unverified**.
7. The original project source recovery and non-trial SignalChart market feeds remain incomplete. Keep the staging Git branch configured not to auto-deploy and preserve the current production alias.

**Cost control:** WhatsApp/Twilio verification providers may bill per delivery. The current code prepares for OTP but does not provision a provider, send real texts, create paid resources, or change the free hosting plan.


## Current audited staging snapshot (9 November 2026)

- **82/82 tests passed** on GitHub commit `1c77a2787a7df578881878b6ce28a071da459b53`: 81 Node.js regression/security tests plus one executed PostgreSQL integration test using PGlite. The tests include a real SQL deployment against a disposable Postgres-compatible engine, role-based data denial, duplicate phone claims, 72-hour expiry, three-signal exhaustion, duplicate opens, and payment entitlement. This is not production Supabase testing.
- Forex and Crypto website navigation now lead to the shared protected `/signals.html` vault; no unrelated branding, fonts, or layouts were changed.
- The release gate has been updated for the 72-hour/three-signal contract and expected source changes. It still rejects deployment due to **19 unverified originals** (some backend files were rewritten, but the original source hashes remain unavailable). There are no additional unexpected-source errors in the current gate report.
- At that earlier snapshot, the connected Vercel project had no privileged Supabase key and no trial HMAC secret. As of the next audit, the **staging HMAC secret is present**, but the privileged Supabase key remains absent. No database migration or SMS integration was applied to the real Supabase account.
- Do not activate paid WhatsApp messaging, accept crypto payments or deploy production from this branch. Current tests exercise fake accounts and a disposable test database; actual phone verification and account migration must be tested against the real Supabase project after authorized connection.
- **Next:** inspect live schema, RLS and historical accounts, provision server-side secret key and stable HMAC secret through Vercel's protected environment, select an approved WhatsApp provider, then run verified-phone/duplicate-phone and concurrent premium-unlock tests with real test identities in a preview deployment.

## Post-migration Supabase advisories

The connected Supabase Security Advisor returned a warning that **leaked password protection is disabled**. Enable it before public signup: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

It also reported 10 informational `rls_enabled_no_policy` notices. For these particular private-only trial tables, **having RLS enabled with no user policies is deliberate**: all direct permissions for `anon` and `authenticated` are revoked, and only server-only service-role RPCs may access them. Do not add permissive policies just to silence the notices.

See [Supabase securing your API](https://supabase.com/docs/guides/api/securing-your-api). **Never expose server secret keys or HMAC secrets to public clients or GitHub.**

## Updated next-step verification contract

1. Configure the server-only Supabase secret key and a securely backed-up HMAC secret for the staging preview environment. These are intentionally NOT in Git or chat.
2. Check Supabase Auth WhatsApp/Twilio configuration and obtain explicit approval before any paid WhatsApp delivery. Verify both successful OTP and abuse rate limiting with real devices.
3. Map verified SignalChart premium signals into `sc_premium_signals`; without this, no unlockable premium content exists.
4. Run actual customer + Super Admin JWT requests against the staging backend, verify historical-user holds and approved payment entitlements, and rerun security advisors.
5. Keep the staging Git auto-deploy disabled. Production alias and live payment settings remain untouched.

## WhatsApp-first verification (configuration prepared; no billable delivery)

- SignalChart uses the **existing verified Supabase email/Google account** and sends a `phone_change` verification code with `PUT /auth/v1/user` payload `{phone,channel:'whatsapp'}`. On verification, Supabase confirms ownership; only then can the immutable phone HMAC and 72-hour/3-signal claim be activated.
- **`SC_TRIAL_PHONE_DELIVERY_ENABLED` defaults to false**. The backend refuses all OTP delivery while disabled and does not fall back to SMS. Customer UI also disables the send control. This is deliberately disabled until the owner approves a configured provider.
- WhatsApp phone change is supported in the current Supabase GoTrue API with **Twilio or Twilio Verify** as the configured provider. WhatsApp is **not automatically free**; billable deliveries need explicit owner authorization. Configure a WhatsApp sender and provider in Supabase Auth before enabling OTP delivery.
- **Free hosted test numbers** use predefined OTP codes, but Supabase requires the Phone provider and a configured SMS/WhatsApp provider even though a matching test number skips message delivery. Thus no real hosted test-number OTP has been sent yet. Use mocked route tests and the disposable database suite until the provider is configured. Remove all test OTPs before public launch.
- Database HMAC and RLS protections, phone-claim uniqueness, existing user legacy hold, and three shared signal credits are unchanged. OTP code and raw phone numbers must not appear in GitHub or application logs.

Sources: https://supabase.com/docs/guides/auth/phone-login ; https://supabase.com/docs/guides/auth/testing-auth-flows ; https://github.com/supabase/auth/blob/master/openapi.yaml

## Latest WhatsApp-only staging result

- Source commit `d2993c89138ca7c99e5a7a8f47515ebdcc6d18e6` enabled the WhatsApp phone-change channel in the existing account and added a default-off delivery gate. The Vercel **preview branch** has `SC_TRIAL_PHONE_DELIVERY_ENABLED=false` explicitly set; production was not changed.
- **83/83** Node.js regression/security tests passed. Two new tests verify disabled mode never contacts Supabase and an invalid delivery value cannot activate an SMS fallback. These are mock tests, not real WhatsApp delivery tests.
- Supabase's hosted test-phone system requires a phone provider to be configured even when it skips message delivery. No test number or provider configuration was installed and no OTP was sent. When a provider is approved, test phone numbers and OTPs must be time-limited and removed before release.
- Continue to treat 72 hours and 3 unique combined premium signals as the authoritative trial terms. The connected Supabase database schema remains as applied; this WhatsApp switch required no new SQL migration.

## 2026-11-09 — HMAC vault backup and staging-only server credential gate

- A new **48-byte cryptographically random HMAC secret** was generated inside the existing Supabase database and stored in encrypted Supabase Vault under the stable name \`sc_trial_hmac_v1\`; no plaintext key was committed. The same value was configured in Vercel as encrypted \`SC_TRIAL_HMAC_SECRET\` only for the preview branch \`signalchart-recovery-staging\`.
- The Vercel preview branch continues to have \`SC_TRIAL_PHONE_DELIVERY_ENABLED=false\` and the established rollout timestamp; no production environment value was changed. This protects the phone-claim HMAC key from accidental rotation or a lost preview env value.
- The connected Supabase plugin can read project metadata, publishable keys, migrations and SQL, but **does not expose a secret API key or offer key creation**. Do not extract signing secrets from PostgreSQL or deploy an unauthenticated endpoint to disclose service credentials. Therefore \`SUPABASE_SECRET_KEY\` is **not yet configured** on staging.
- Read-only REST requests using the actual project's public \`sb_publishable\` key returned **401** for \`sc_trials\`, \`sc_premium_signals\`, \`sc_trial_state\`, and \`sc_unlock_trial\`. A deliberately invalid user JWT was rejected with **403**. These were real requests to the connected project, not mocked tests.
- A read-only verification script was committed at \`scripts/qa-live-supabase-trial.cjs\`. It checks public denial, protected server RPC and (if a temporary user access token is supplied) verified-user state, without recording trial unlocks or sending OTPs.

**Blocked action requiring a secure credential handoff:** Add the **existing Supabase secret key** from \`https://supabase.com/dashboard/project/nnailvcgaupjtdaxvjsx/settings/api-keys\` to the connected Vercel project as \`SUPABASE_SECRET_KEY\`, target **Preview**, restricted to branch \`signalchart-recovery-staging\`, encrypted. **Never paste the key into a chat or GitHub.** The platform must continue to fail closed while it is absent. After adding it, rerun the read-only smoke test and verify a real signed-in test user. WhatsApp provider and paid messaging remain off.

## Live connected staging credential and boundary audit (November 9, 2026)

Read-only checks against the connected Supabase project `nnailvcgaupjtdaxvjsx` and the existing Vercel SignalChart project:

- Staging-preview-only `SC_TRIAL_HMAC_SECRET` is **present** in an encrypted Vercel environment variable, 96 characters long. **Preserve this value**; never regenerate/rotate without a reviewed phone-claim migration.
- `SC_TRIAL_ROLLOUT_AT` is present only for `signalchart-recovery-staging`; `SC_TRIAL_PHONE_DELIVERY_ENABLED=false` is still explicitly set in staging.
- `SUPABASE_URL` matches this Supabase project exactly. The configured `SUPABASE_PUBLISHABLE_KEY` matches one of its currently active publishable keys.
- **Still missing:** `SUPABASE_SECRET_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY` in the Vercel project. The connected Supabase management app exposes publishable keys but cannot reveal an elevated server key. Do not substitute the public key or try to obtain privileged credentials from database internal settings.
- Executed **6/6 live anonymous HTTP denial probes** through `scripts/verify-live-trial-boundaries.mjs` using *only* the publishable key. The direct REST table requests and trial RPC requests all returned **HTTP 401**; none returned data or modified the project.
- Live DB: 10 SignalChart RLS-enabled tables, zero direct public table SELECT permissions, zero `sc_*` functions callable by public roles. The only existing historical account returns `trialStatus=not_activated`, and `sc_can_override_legacy_trial` returned **false** for an unapproved trial attempt.
- No valid customer JWT or staging server secret was available for an authenticated end-to-end test. Therefore **do not claim verified OTP activation, signed-in premium unlocking, or membership conversion**.
- SMS/WhatsApp delivery stays disabled and no paid provider or Vercel deployment was authorized or initiated.

**Precise next action:** In the existing Supabase project dashboard, obtain or create a server-side secret key via **Settings → API Keys → Secret keys**. Add it yourself to the existing Vercel project as `SUPABASE_SECRET_KEY`, with target **Preview** and branch **signalchart-recovery-staging only**. Use a Sensitive/Encrypted variable. Do not paste the key in a chat, expose it via public config, or commit it to Git. Once present, verify privileged RPC read-only access and then run controlled authenticated tests with a non-billable test account. Keep WhatsApp sending disabled pending provider/cost approval.
