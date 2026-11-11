# SignalChart: zero-cost Cloudflare and Supabase migration handoff

Last updated: November 10, 2026. Continue this exact branch in ChatGPT Work.

## Project scope
- GitHub repository: AdanKhanSwati/signal-chart
- Migration branch: signalchart-cloudflare-free-migration (based on signalchart-recovery-staging).
- Supabase project: nnailvcgaupjtdaxvjsx, Free tier.
- Historical Vercel project: candriva-signals-beta (prj_FfIFhVu7L5ZFagJvfAfDIelVNGZC).
- Cloudflare has NOT yet been connected or deployed. Do not modify production without successful security QA and approval.
- User's required mandatory infrastructure budget: USD 0 per month until several paying customers. Do not enable paid plans or collect money without explicit approval.
- Keep SignalChart separate from AuxWork Trades and other projects, and preserve approved UI and branding.

## Work completed in this chat
1. Created isolated migration branch in GitHub.
2. Committed lib/supabase-profile-store.js, a server-only Supabase PostgREST adapter using verified Auth user IDs, one-record reads and idempotent inserts. It does NOT grant administrator rights, free trials, or paid access.
3. Added database/sc-member-profiles.sql. Applied it in the existing Supabase project under migration name sc_member_profiles_phase_one. The new public.sc_member_profiles table has RLS enabled, no direct anon or authenticated privileges, and service_role read/insert access. Initially zero rows; existing login, trial and paid-access data remain unchanged.
4. Added tests/supabase-profile-store.test.js (10 passing focused tests).
5. Added cloudflare/public-assets.json with an explicit allowlist of 78 existing public website files, excluding setup.html, secrets, backend code, database files, tests and tooling.
6. Added scripts/build-cloudflare-static.cjs to copy exactly these approved files to .cloudflare-dist, and cloudflare/wrangler.static-preview.json for STATIC-ONLY preview (not functioning dynamic APIs).
7. Added tests/cloudflare-static-export.test.js (3 passing focused tests), and updated .gitignore to exclude .cloudflare-dist and .wrangler.
8. Executed full Node test suite: 188 tests passed, 0 failed. Successfully generated the 78-file static export.
9. Verified Supabase table access controls: RLS enabled, anon SELECT false, authenticated SELECT false, service_role SELECT/INSERT true.

## Confirmed root cause of broken login
Supabase password sign-in succeeds, but the historical app's member API fails because the Vercel Blob backing store was quota-suspended. Historical Blob store candriva-private-accounts, id store_2Db1a69SRx9ElbsV, status limits-exceeded-suspended, approximately 5 stored objects and 16.6 KB. Disposable write in isolated QA failed with "Vercel Blob: This store has been suspended." Do not discard or fabricate historical payment, entitlement or trial records. Recovery and reconciliation are required before completing the cutover.

## Next work, in order
1. Use a connected Cloudflare account (not yet available in this conversation) to prepare a zero-cost Workers project and private staging. Never enable paid Workers.
2. Port Vercel API handlers and rewrites to the Workers Fetch API or appropriately isolated Supabase Edge Functions; current API routes are not ported. Cloudflare Workers Free has 100,000 requests/day but only 10ms CPU per regular request; do not run heavy candle/technical analysis in a Worker request.
3. Wire authenticated membership flow to the new Supabase profile store: verify the Supabase user token at /auth/v1/user and only then use ensureProfile. Preserve existing profile and login semantics. Profiles are NOT entitlements.
4. Port the remaining Blob-dependent billing, payment, administrator, manual-grant, audit and decision data to structured Supabase tables with RLS and server-only secrets, and migrate receipts to private Supabase Storage. Reconcile the existing five Blob objects read-only when access is restored. Do NOT automatically grant premium access from incomplete records or reset historical trials.
5. Preserve the existing SQL trial authority (sc_trials, three-unlock cap, 72-hour eligibility), and historical paid entitlements where proven. Cross-check unique payment transaction IDs and prevent concurrent review abuse. Payments must remain disabled throughout migration.
6. Port market charts, forex/crypto signals, event/news APIs and scheduled scanning with appropriate caching and execution offloading to fit free limits. Unattended publishing remains disabled until real research/backtests and live QA establish integrity.
7. Set up Supabase Auth redirects and a free transactional SMTP route for signup and password reset, using the new Cloudflare staging URL.
8. Perform end-to-end tests: fresh and historical verified user login, RLS isolation, trial cap, trial expiry, unpaid access, admin restrictions, manual payment status, signal accuracy safeguards, and responsive/mobile browser QA.
9. Deploy and switch domains only after all of the above and explicit approval. Keep the existing production website unchanged in the meantime.

## Cautions and remaining blockers
- The migration branch is not deployable as a complete customer website yet. Its Cloudflare config is only for static assets; /api routes are not implemented.
- No Cloudflare account is connected in this chat. Work can use a supported cloud browser or connector and may require user login.
- Do not use server-side Supabase secret/service role keys in client JavaScript, GitHub files, or browser logs. Modern sb_secret keys are passed as an apikey header only.
- New RLS table intentionally has no browser policies. Supabase security advisor also flagged leaked-password protection disabled on the project. Review before launch.
- Existing member, payment and trial data has not yet been copied. Cloudflare API port and real logged-in user test remain undone.
- Aim for $0 recurring infrastructure; free quotas and external market-data limitations must be monitored.
- Do not claim SignalChart is production-ready until real integration tests and recovery have passed.

## Commands for next engineering session
- node --test tests/supabase-profile-store.test.js tests/cloudflare-static-export.test.js
- node --test tests/*.test.js
- node scripts/build-cloudflare-static.cjs

Success means verified users can securely log in on Cloudflare staging and see correct membership, without losing history, exposing server keys, granting false premium access, enabling payments or paying monthly hosting fees.


## November 11 continuation: Cloudflare staging API implemented

- Added cloudflare/worker.mjs, a Cloudflare Fetch API adapter covering GET /api/config, GET /api/health, GET /api/trial?action=state, and GET /api/member?action=me.
- It validates the incoming Supabase user session via Auth /auth/v1/user, requires verified email, derives UID strictly from the Auth server response, and then queries server-only Supabase sc_member_profiles, sc_trial_state and sc_paid_access.
- Private RLS-restricted table reads use a Worker-side secret or legacy service-role token; neither may be embedded into the public static bundle. Frontend Supabase Auth continues to use only the publishable key.
- Paid entitlements are only granted from verified and unrevoked active sc_paid_access rows. Historical Blob-paid records remain unreconciled, so do not launch the adapter as a full production entitlement service until Blob recovery and historical reconciliation are complete.
- Every unmigrated API remains explicitly HTTP 503; payment submissions, payment approvals, admin endpoints, trial activation and signal generation remain disabled. No new trials or payments are accepted by this Worker.
- Added cloudflare/wrangler.staging.json: assets binding, API-first selective routes, staging workers.dev name. This is still not deployed; no Cloudflare account integration exists in this chat.
- Added tests/cloudflare-worker.test.js with 14 regression tests for verified user isolation, trial state, paid SQL entitlement, rejecting revoked/pending payments, auth failures, missing private key, and immutable profile creation.
- Added branch-only GitHub Actions QA workflow at .github/workflows/cloudflare-migration-qa.yml (Node 22, complete test suite, static export, secret/public file boundary checks). CI execution status was not yet confirmed through connector.
- Syntax and logic of the exact committed Worker source were checked through a separate isolated JavaScript evaluator: 7 mock routing/auth tests passed. This is NOT equivalent to executing the full Node or Cloudflare Worker integration test suite.
- Corrected vercel.json to set git.deploymentEnabled.signalchart-cloudflare-free-migration=false to stop future accidental Vercel Git previews.
- **Next**: Confirm GitHub Actions QA result; complete Cloudflare deployment access via Work cloud browser and configure three Worker secrets (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY) without committing them; integrate private SQL billing migration, safe payment receipt storage and legacy record recovery; port market/signal APIs; verify existing user sign-ins on Cloudflare staging and finish production approval gates.
- User requested autonomous continuation for three hours, no interruptions. A three-run hourly ChatGPT automation has been created to revisit this exact branch, commit safe incremental work and only report completion or a genuine user-required blocker at the final attempt. No three-hour completion guarantee can be made.


## 2026-11-11 engineering continuation — account trials and public markets

- Cloudflare staging Worker now supports secure, optional browser trial registration:
  - GET /api/trial?action=device issues an HttpOnly, Secure, SameSite=Lax, HMAC-signed first-party cookie, only for verified Supabase users.
  - POST /api/trial?action=activate_browser enforces verified Supabase user ID, server-controlled historical-account cutoff, signed cookie, Cloudflare Turnstile Siteverify action and hostname, and transactional sc_activate_browser_trial RPC.
  - Cookie signature verification rejects noncanonical base64url aliases. Browser/IP hashes are advisory for SQL anti-abuse, never premium authorization.
  - The trial feature remains DISABLED until all required Worker-side secrets, Turnstile host registration and rollout date are configured. Historical accounts created before cutoff are fail-closed pending review.
- Added Cloudflare public market metadata and historical candles:
  - cloudflare/market-catalog.mjs supports live Binance USD-M listing, validated symbols, 10-minute in-isolate cache, and a bounded crypto fallback + existing FX pair catalog.
  - cloudflare/market-candles.mjs supports Binance perpetual OHLC and Yahoo indicative FX candles, validates exchange-provided bars, limits provider response sizes/timeouts, and caches quotes briefly.
  - Routes GET /api/markets, GET /api/candles?action=markets and GET /api/candles?market=...&symbol=...&interval=....
  - These are READ-ONLY public market data endpoints, not trading signals or paid signal unlocks. Third-party chart availability must be checked live before launch.
- Added regression tests for browser-trial no-cookie/auth, Turnstile mismatch, historical lockout, SQL trial claim, market listing and price history.
- GitHub Actions ran 223 tests successfully (0 failures) and successfully compiled Cloudflare Worker with 78 static assets using Wrangler 4 dry-run; no deployment or paid service was activated. A flaky cookie tampering test revealed noncanonical base64url acceptance and was fixed with exact canonical comparison. Latest tests/CI should be checked before release.
- Added cloudflare/README.md with exact zero-cost staging commands, Worker environment requirements and production cutover blockers.
- Added .dev.vars and .dev.vars.* to .gitignore to prevent accidentally committing local Cloudflare secrets.
- NOT YET COMPLETE: Cloudflare account/dashboard is not connected for actual staging deployment; signalchart.pro DNS unchanged; private legacy Vercel Blob membership/payment recovery incomplete; premium signal, payment, support and super-admin APIs still not ported. Do not launch as paid customer platform yet.


## November 11 continued: secure premium signals, billing safety and customer support

- Ported `GET /api/premium-signals?action=list` with a strictly public four-field response and `POST /api/premium-signals?action=unlock` with verified Supabase Auth, SQL-only paid entitlements and the existing atomic three-unique-signals trial RPC. Feature is off by default unless Worker secret `SC_PREMIUM_UNLOCK_ENABLED=true` is explicitly enabled after historical entitlement reconciliation. No client-supplied UID, admin metadata or payment flag is trusted. Premium payload responses are private/no-store.
- Ported `GET /api/cv-ops?action=me` to verified user-only membership with payment collection disabled and an honest historical-billing migration notice. Frontend billing page hides BTC wallet address, QR code, quote and payment submission while disabled, rather than encouraging transfers to an inactive invoice workflow.
- Created private support tables and service-role-only RPCs in `database/sc-support-messages.sql`; applied migration `sc_support_messages_phase_two` to Supabase. Privilege checks confirmed RLS enabled and anonymous/authenticated access denied on both tables and all support functions.
- Ported customer support inbox, owned-ticket message reads, ticket creation, replies and close actions to `/api/cv-ops` using verified Auth identity, user ownership checks, SQL rate limits, and optional server-only `SC_SUPER_ADMIN_UID` for staff conversation access. Other users' ticket existence is concealed.
- Added `tests/cloudflare-premium-signals.test.js`, `tests/cloudflare-billing-maintenance.test.js`, and `tests/cloudflare-support.test.js`. **GitHub Actions run 42954286299 passed 255 tests, 0 failed and compiled the Cloudflare Worker plus 78 assets in Wrangler dry-run**. No Cloudflare deployment occurred.
- Updated `cloudflare/README.md` with new routes and integration flags.

**Remaining**: actual Cloudflare account integration and workers.dev staging URL, live browser E2E sign-in/testing, payment and receipt migration from suspended Vercel Blob, administrator billing/review backend, automated and backtested research/signals, news/calendar and final production readiness. Do not change signalchart.pro or accept live payments until these are verified. Mandatory hosting target remains $0/month.
