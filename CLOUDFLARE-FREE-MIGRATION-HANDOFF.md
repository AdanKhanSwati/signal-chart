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

## November 11 continuation — read-only news/calendar port

- Added `cloudflare/research.mjs` and `tests/cloudflare-research.test.js` for `/api/research` health, news and calendar modes. News uses source-attributed Federal Reserve/BLS RSS/Atom feeds with official-domain link validation; the calendar uses official BLS ICS and attributed Forex Factory weekly JSON. Fixed upstream hosts, 350 KB body limits, short timeouts, bounded parsing and in-isolate caching prevent arbitrary URL fetches or invented event data.
- Calendar event coverage fails closed: FULL_WEEK requires both current sources; PARTIAL_US requires current BLS only; otherwise UNKNOWN, and assessment remains blocked. The UI receives its existing `events`, `news`, `providers` and `assessment` contract.
- Paid historical backtesting is intentionally HTTP 503, not a misleading stub. No payments, signal publishing, entitlement grants or DNS changes.
- Next: check CI for the commit that added this section, confirm live provider parsing and news links on a Cloudflare staging deployment, then address historical Blob reconciliation, billing/admin data, and remaining market APIs. No production readiness claim.

- Additional conservative calendar safeguard: a Forex Factory feed with only historical weekly entries cannot certify FULL_WEEK coverage. It must include an upcoming event (within eight days), otherwise coverage remains partial/unknown. Added a dedicated regression test.

### Verified CI result for the research milestone

- GitHub Actions run **42955267222** on commit `8855b54245ed535019d4db0de59a5f4b1aeea778` passed on November 11, 2026: **267 Node tests passed, 0 failed**, 78 allowlisted static assets exported, and Wrangler 4 compiled the Cloudflare Worker successfully in **dry-run only**. The code remains undeployed and live provider responses have not been exercised in a Cloudflare Worker.
- Supabase project `nnailvcgaupjtdaxvjsx` is ACTIVE_HEALTHY and its organization remains on the **Free** tier. No database mutations were performed in this research continuation. Supabase security advisor still warns that leaked-password protection is disabled; RLS/no-policy informational findings are expected for intentionally server-only tables.
- The next engineering priority is a **quarantined, non-entitlement historical Blob recovery ledger** and safe admin reconciliation tooling, without enabling checkout or creating access from unverified records. Cloudflare Workers Free staging access and browser E2E remain blocked until an account session is available. Do not modify DNS.

## November 11 continuation — historical recovery quarantine and inventory tooling

- Created and APPLIED Supabase migrations sc_legacy_recovery_ledger and sc_legacy_recovery_tighten_grants. New private tables public.sc_legacy_recovery_items and public.sc_legacy_recovery_events have RLS and no anonymous/authenticated access. Service-role DELETE/TRUNCATE privileges revoked for both; events cannot be UPDATEd through service-role API. Verified effective privileges with SQL.
- Recovery inventory and audit are not linked to automatic membership, paid access, admin role or trial grants. Newly created tables hold ZERO recovered items and ZERO events. No legacy payments/receipts have been imported or reconciled; existing sc_paid_access and sc_trials remain unchanged.
- Added authenticated server-only GET /api/recovery?action=status to Cloudflare Worker; requires SC_SUPER_ADMIN_UID equal to verified Supabase Auth UUID. Returns aggregate counts, NEVER private paths/identities/evidence. Rejects writes and cross-user access. Never declares the complete old Blob store recovered based solely on reviewing rows of a partial inventory.
- Added scripts/stage-blob-inventory.cjs: explicit private JSON source listing intake with complete=true, validation, dry-run default and independently confirmed SC_RECOVERY_IMPORT_APPROVED=true + --write for limited 100-row Supabase inserts. Duplicate historical paths are ignored, not overwritten. This script CANNOT read original Blob bodies, grant access, or validate payment transactions. No private manifest has been supplied or used yet.
- Added tests/cloudflare-recovery-status.test.js and tests/cloudflare-legacy-inventory-import.test.js. Added .gitignore patterns for private inventories.
- See cloudflare/README.md for the precise manifest format and safe handoff procedure. Original store listing must be recovered READ-ONLY from the suspended Blob account, and all pages verified before using the importer. The source manifest contains sensitive identifiers: keep it outside Git and never post it to a public frontend.
- Production DNS is unchanged, customer payment collection remains disabled, and Cloudflare staging is not deployed because there is no connected Cloudflare account session in this chat.

NEXT engineering priorities: 1) inspect latest GitHub Actions run for successful tests and Wrangler dry-run, 2) recover/read/verify the old Vercel Blob objects or get authorized restoration, 3) create manual evidence reconciliation workflow with proper server admin gate and no auto-entitlements, 4) migrate admin billing/receipts carefully, 5) Cloudflare staging deployment and browser E2E, 6) real signal/research validation before final cutover.


### 2026-11-11: Evidence storage prepared

- APPLIED Supabase migration sc_legacy_evidence_bucket: private sc-legacy-evidence Storage bucket, 3 MiB object cap, JSON/PNG/JPEG only. Verified public=false, zero objects, zero storage.objects policies. No actual evidence has been transferred.
- Authenticated read-only Cloudflare endpoint GET /api/recovery?action=status is server-admin gated and returns aggregate counts only; writes denied.
- Completed and CI-tested the safe metadata importer scripts/stage-blob-inventory.cjs. It requires a COMPLETE private paginated Vercel Blob list export and performs only idempotent inventory inserts after a separate explicit write opt-in. The old source inventory is not yet available, so nothing was imported.
- As of the latest full CI check: 287 Node tests passed, zero failed; Wrangler successfully dry-ran Worker bundle and all 78 static assets. No paid services activated or DNS modifications made.
- NEXT: Obtain the original private Blob read access or authorized restoration, preserve full source inventory+content hashes in quarantine, then reconcile each payment/trial/customer record separately. Never treat inventory completeness as proved by a few reviewed rows.


### November 11 continuation — offline legacy evidence integrity preflight

- Added `scripts/verify-blob-evidence.cjs`: a bounded, **offline/read-only** preflight for locally recovered historical Blob copies. It requires the complete source inventory plus a separate recovered-file manifest; cross-checks exact source keys and byte sizes; computes SHA-256; optionally compares an independently supplied digest; and validates JSON/PNG/JPEG formats against the existing private bucket's 3 MiB cap.
- It rejects duplicate or unlisted objects, symlinks, path traversal, invalid formats, oversized evidence and mismatched hashes. A sensitive detailed report can be created outside the Git working directory with exclusive 0600 permissions; console output remains aggregate-only.
- Added `tests/cloudflare-legacy-evidence-preflight.test.js` with nine focused security/regression tests. These nine tests passed locally in an isolated Node 22 fixture using a minimal stand-in for the existing inventory-normalization module; **GitHub Actions is the authority for full-repository integration/regression verification**.
- This tooling does **not** retrieve the suspended Blob store, upload to Supabase Storage, update any database row, validate payment ownership, mark an item reconciled, enable trials or grant premium. No real evidence or legacy inventory was supplied. Supabase quarantine tables still held zero records at the beginning of this continuation.
- Detailed invocation and privacy cautions are in `cloudflare/README.md`. The immediate external blocker remains legitimate read-only access to the original suspended Vercel Blob objects and complete paginated inventory; actual Cloudflare staging login and browser E2E still need an authorized Cloudflare account session. No DNS or production changes were made.
- **Next**: confirm the branch's latest GitHub Actions result (all Node tests + Wrangler dry-run), then implement audited server-only evidence upload and manual review transitions once source provenance can be independently verified. Keep any SQL review status informational; never derive payment/trial/access authority from recovery metadata.


### November 11 — private evidence copy indexing and audit hardening

- Added `database/sc-legacy-evidence-copy-index.sql` and **applied** Supabase migration `sc_legacy_evidence_copy_index`. New `sc_legacy_evidence_copies` is append-only from the operator workflow, with RLS, no client permissions/policies and no service-role DELETE. It stores SHA-256, private content-addressed path, byte size and MIME only against an **existing** historical inventory item; immutable flags prohibit claims of source authenticity, verified payment or access granted.
- Added `scripts/index-blob-evidence.cjs` with independent `SC_EVIDENCE_INDEX_APPROVED=true`, verified operator UUID, and a complete private inventory plus recovered-file manifest. It rehashes the private Supabase Storage object via a server-side read before calling the restricted `sc_recovery_record_local_copy` RPC. It cannot invent missing inventory rows, alter retrieval/review status, grant access or verify a payment. The RPC records an append-only `evidence_recovered` audit event on a new link.
- Added `tests/cloudflare-evidence-index.test.js` (eight tests) covering approval gates, no client keys, private readback, SHA mismatch, duplicate/forged object identities, idempotence, RPC failures and zero entitlement authority. The concurrent migration branch also added `sc_recovery_link_evidence` and an optional `upload-blob-evidence.cjs --link-ledger` path; that path updates the inventory's `verified_read` status, whereas the standalone indexer intentionally **does not**. Prefer the append-only indexer until original source provenance is independently established.
- Supabase verification: historical inventory rows **0**, private evidence copy rows **0**, audit events **0**, and quarantine Storage objects **0**. Verified `anon` SELECT=false, `authenticated` INSERT=false, service-role DELETE=false, authenticated RPC EXECUTE=false and service-role RPC EXECUTE=true. No real legacy files were imported or indexed.
- GitHub Actions run `42968028006` on commit `c16e621cc381` passed **331 Node tests, zero failures**, exported **78 allowlisted assets**, and completed the Wrangler 4 Worker **dry-run**. No Cloudflare deployment or DNS change occurred. This is automated CI only, not live Cloudflare integration verification.
- Remaining external actions: obtain legitimate read-only access to the **complete** suspended historical Blob store and every object; then privately verify and quarantine copies. A Cloudflare account session/authorized staging deployment is still required for live browser E2E. No customer payments, trial/premium grants or production cutover until reconciliation and full staging QA. Do not use Vercel for new hosting/testing.


### November 11, 2026 — verified private uploads and audited non-entitlement review

- Added scripts/upload-blob-evidence.cjs, whose --dry-run re-verifies every recovered file against the complete source inventory; --write requires SC_EVIDENCE_UPLOAD_APPROVED=true and a server-only Supabase key. It uploads to the private sc-legacy-evidence bucket without overwrites and independently downloads/re-hashes stored bytes before counting them. No legacy source files exist yet, so NO real uploads occurred.
- Added optional --link-ledger flag with separate SC_RECOVERY_LINK_APPROVED=true plus SC_SUPER_ADMIN_UID and a gated service-role RPC sc_recovery_link_evidence; applied migration sc_legacy_evidence_link. This records evidence as verified_read, but it does NOT establish original Vercel provenance, ownership or payment. Do not use until original source completeness is independently verified; prefer the safer append-only sc_legacy_evidence_copies indexer for current recovery work.
- Concurrent continuation independently added sc_legacy_evidence_copies and scripts/index-blob-evidence.cjs: the PREFERRED write path for the next recovery phase. It links locally hashed, privately re-read evidence in a separate append-only table and does NOT modify the source inventory retrieval or review status. Source contents, users, payment ownership and historical access remain unverified.
- Applied migration sc_legacy_recovery_review_notes: service-role-only sc_recovery_add_review_note with verified-actor checks, a rate limit, append-only event, and no entitlement effects. Added POST /api/recovery?action=note: only configured verified SC_SUPER_ADMIN_UID may submit a bounded note on an existing item; cannot approve a payment. Its tests verify spoofed admin metadata, missing role, missing item and invalid payload are rejected.
- Checked active Vercel store store_2Db1a69SRx9ElbsV again: it remains limits-exceeded-suspended, usageQuotaExceeded=true, with five private objects and 16,647 bytes. No source listing/body was recovered, and nothing was deleted or changed.
- CI on commit 619734d867e1ac80c36d93cb4db5e7da82532fb9: **331 tests passed, 0 failed**, 78 static public assets exported, Cloudflare Worker Wrangler 4 dry-run compiled. All work remains on the isolated migration branch; live domain DNS was not edited and no customer payments were accepted.
- Verification of function privileges confirmed anon/authenticated cannot call sc_recovery_link_evidence or sc_recovery_add_review_note; service role can. The private storage bucket remains closed to browser roles.
- No paid access, trial, real evidence, invoice, or review decisions were created by this continuation.

NEXT: 1) recover the real source inventory and encrypted/private files from old suspended Vercel Blob through authorized access; 2) stage evidence using private preflight then upload then PREFERRED copy index (no inventory status escalation); 3) verify original historical membership/payment source and define independently reviewed entitlement grants; 4) connect actual Cloudflare workers.dev staging session and secrets, run E2E; 5) finish outstanding billing/admin and automated signals before production approval. $0 monthly infrastructure target remains.


### November 11 release QA safeguard

- Added GET /api/ready for explicit fail-closed launch readiness (always HTTP 503 while historical Blob records, admin billing, provider reliability and signed-in staging tests are not verified), distinct from GET /api/health HTTP 200 liveness. No credentials or personal data are returned. Automated tests cover configured and unconfigured Workers.
- GitHub Actions latest verified run 42968423826, commit dc39374406b1eec4c5165c1bed827360224ade6e: **334 tests passed, zero failed**, 78 allowlisted public assets exported, Wrangler dry-run successful. This is source/build QA only, NOT live Cloudflare verification. No production DNS, payment state, trials or user entitlements were changed.
- The private recovery uploader can optionally link evidence into recovery inventory after independent approval, but the PREFERRED path is the separate append-only evidence copy indexer, which leaves source retrieval/review state unchanged until full original Vercel provenance is independently verified. Historical Blob store is still suspended and source data remains inaccessible.


### November 11 — additional release-gate regression coverage
- Added `tests/cloudflare-release-gates.test.js` on the migration branch (commit `e916c90c730b79bb8978be4782dcbc4364beb5b2`). It tests fail-closed readiness without secrets, query-string approval spoofing, disabled unmigrated payment/admin/signal routes, and rejection of readiness mutations.
- These tests do not deploy a Worker, grant access or recover Blob records. Verify the new commit's GitHub Actions result before treating them as passing; prior verified run 42968553076 passed 334 tests.
- Still blocked on authorized Cloudflare staging session and complete legitimate read-only Blob recovery. No production DNS, payments or trial flags should change.

## 2026-11-11 — Android Market Terminal restoration (awaiting live Cloudflare browser test)

User screenshot of signal-chart.auxwork3.workers.dev/terminal.html showed BTCUSDT quote with unavailable candles, eight watchlist entries and green-tinted styling inconsistent with approved orange/charcoal brand.

Changes on signalchart-cloudflare-free-migration:
- market-charts.js uses the actual Cloudflare GET /api/markets endpoint (not retired /api/quotes?mode=catalog), validates imported symbols, searches across all pairs, displays a dynamic count and progressively reveals more symbols. Includes 50+ FX metadata symbols and many crypto markets when Binance is available.
- cloudflare/market-catalog.mjs first requests real Binance perpetual futures; on upstream restriction it requests the documented Binance Spot market-data-only exchangeInfo with symbolStatus=TRADING and showPermissionSets=false. Spot contracts are transparently labeled as Spot, not as USD-M futures. Final bounded static fallback is acknowledged if both endpoints fail.
- cloudflare/market-candles.mjs requests genuine Binance USD-M perpetual candles first; if unavailable tries real Binance Spot OHLC; finally tries genuine Coinbase USD spot reference OHLC for supported symbols/timeframes. No fabricated candles. Each successful result includes provider source, instrument type, quoteCurrency and aliasOnly for USD-vs-USDT conversion. Provider timeout shortened to 5s.
- market-charts.js uses the actual returned chart source and charcoal-neutral chart grids, orange EMA, and truthful source/error messages. User-visible terminal label no longer advertises a fixed eight markets.
- signalchart-terminal-brand.css provides a scoped responsive charcoal/graphite/orange terminal UI, without replacing or altering SignalChart original wordmark/logo. Added to terminal.html and 79-file asset allowlist.
- Added tests/cloudflare-terminal-restoration.test.js and expanded backend market/catalog regression coverage. CI passed 346/346 tests in run 43009039393; follow-up timeout/provider source changes passed GitHub Actions run 43009426141 with Wrangler dry-run.

Important: CI tests mock upstream providers, and no live browser/HTTP verification of the Cloudflare deployment has yet occurred. Do not claim all charts now work live. The live signal-chart Worker still needs to automatically deploy these commits and be retested on Android.

Next acceptance steps: GET /api/markets -> check source and market counts; GET /api/candles?market=crypto&symbol=BTCUSDT&interval=1m -> require HTTP 200 and real OHLC bars with source; open /terminal.html on Android and verify 1m/15m chart and full searchable catalog including EURJPY, BTC, ADA; inspect Cloudflare upstream logs if provider blocks persist. Keep payments/trials disabled and signalchart.pro DNS unchanged.


### 2026-11-11 — Forex provider fallback and mobile lag reduction

User mobile screenshot on signal-chart.auxwork3.workers.dev/terminal.html showed EURUSD and GBPUSD reference quotes absent, every forex candle URL returning HTTP 502, and user reported slow/laggy UI. BTC and many crypto charts loaded; some altcoins failed.

Committed on signalchart-cloudflare-free-migration:
- cloudflare/market-candles.mjs now tries a bounded real historical AlgoSpecial broker OHLC feed for supported forex pairs/timeframes (no key; free research/commercial use with 60/min and 1000/day published limits). Sources are identified as historical and explicitly labeled broker server wall time with unverified UTC offset. If unavailable, Yahoo query1 and query2 now race concurrently to avoid serial 5s timeouts. Successful forex OHLC is cached 180s per isolate; failure is negatively cached 25s; no candles invented.
- market-charts.js uses the official TradingView tv-advanced-chart Web Component as a LAST-RESORT provider-hosted reference when no authentic OHLC is returned. Forex TradingView FX:<pair> or crypto BINANCE:<pair> spot sources are shown as separate providers; no internal indicators/backtests/signals are fabricated from the hosted chart. Hosted module is lazy loaded only on a real upstream failure.
- cloudflare/forex-reference.mjs now returns explicitly non-tradable daily mid/reference forex quotes from commercial-use-permitted free Frankfurter blends. It uses exactly one cached USD-base provider snapshot and computes currency crosses as ratios of that snapshot. No broker bid/ask, OHLC or live prices are invented. Cloudflare Worker ports GET /api/quotes?market=forex read-only, leaves crypto quotes unported.
- market-charts.js now loads daily forex reference rates at most once per 15 minutes in visible tabs, marks them REFERENCE with the published date, avoids overriding newer source data with stale broker history, and no longer polls the missing crypto-quote endpoint every 30s.
- Market watchlist redraws are throttled to 9s on ticker events; the 80-row overview no longer rebuilds on each ticker batch. Selected pair logo, headings and nav are not recreated on every tick.
- market-feed.js batches ticker UI events at 3000ms on terminal (versus 350ms elsewhere), disconnects crypto bulk ticker when forex is selected, and stops sockets while hidden with restoration on return.
- Added tests for conservative provider parsing, broken timestamps, explicit rate references, rate caching, market source labels, visibility and fallback scripts. Latest successful GitHub Actions run 43055405067: 355 tests passed, zero failures, 79 static assets, Wrangler dry-run succeeded.

Notes: AlgoSpecial publisher reports broker timestamps without public UTC offset; do not use these timestamps for exact session-based signal generation without separate verification. Frankfurter blended daily rates are not tradable broker quotes. TradingView hosted charts have an independent data connection and may be unavailable for some symbols/browsers. The complete 50+ forex metadata list is NOT guaranteed to have an available primary historical provider on every timeframe. Never fake missing candles. Actual provider access from Cloudflare edge cannot be verified through GitHub tests.

Next live acceptance: check HTTP and source metadata from /api/quotes?market=forex, /api/candles?market=forex&symbol=EURUSD&interval=15m, /api/candles?market=forex&symbol=GBPUSD&interval=1m and /api/candles?market=crypto&symbol=ADAUSDT&interval=15m; open /terminal.html on Android, confirm daily forex reference prices are explicitly labeled, new raw OHLC candles display or TradingView hosted fallback appears, symbol changes do not hang or stutter, and hidden/visible tab restores crypto streaming. Test with mobile data and Wi-Fi. Do not claim production-ready or enable billing/trials; no DNS edits or paid infrastructure activated.


## 2026-11-12 — Cloudflare unattended hourly RESEARCH dry-run (NO PUBLICATION)

Why: SignalChart has a legacy Node/Vercel automatic signal engine, but Cloudflare Worker staging did not have its hourly scanner. Supabase Cron job signalchart-hourly-auto-scan exists and is INACTIVE; public.sc_auto_signal_control.enabled is false. Keep both publication gates disabled.

Implemented on signalchart-cloudflare-free-migration:
- cloudflare/signal-strategy.mjs: portable ESM copy of the existing deterministic EMA20/50 + RSI14 + ATR14 + 4-hour-confirmed breakout evaluator. A regression test compares results and completed candle validation against lib/sc-auto-engine.js, preventing strategy drift.
- cloudflare/auto-scanner.mjs: POST /api/auto-signals requires a 10-digit Unix timestamp, recent (+/-180 seconds) HMAC SHA-256 signature of timestamp + '.{}' with SC_AUTO_CRON_SECRET (>=32 characters) verified by Workers Web Crypto. The route rejects GET and unsigned requests. SC_AUTO_RESEARCH_ENABLED must explicitly equal 'true'; default is disabled. There are no client-side secrets.
- A Cloudflare-native scheduled(controller, env, ctx) handler and Wrangler cron '7 * * * *' (UTC) are deployed with the staging Worker. When SC_AUTO_RESEARCH_ENABLED is missing, the scheduled handler returns immediately, with NO market, news, database, premium, payment or user activity. Do not also activate the old Supabase Cron until a single scheduling owner is chosen.
- When explicitly enabled for a controlled staging test, the scanner requests one attributed economic-calendar snapshot and insists on fresh FULL_WEEK coverage. Missing source data blocks all markets. It evaluates a bounded universe of eight crypto futures pairs and three indicative FX history pairs. It uses only validated COMPLETED hourly futures candles for crypto, never substitutes a spot/USD chart for a futures signal, and flags FX as INDICATIVE_ONLY (never customer-actionable). Every scan has published:0; result payload excludes direction, entry, SL, TP, signalKey and strategy-private details.
- cloudflare/scan-audit.mjs: native scheduled scans write only safe counters and dry-run metadata to the existing service-role-only public.sc_record_auto_scan RPC if valid backend credentials exist. No premium publication calls or subscription changes are possible from this module. Error/audit failures do not activate publication. The privileged RPC's EXECUTE grants were verified in the real Supabase DB: service_role=true; anon=false; authenticated=false; sc_auto_scan_runs RLS=true.
- Tests/cloudflare-hourly-scanner.test.js and tests/cloudflare-auto-scan-audit.test.js exercise HMAC denial, macro fail-closed, legacy strategy parity, hidden trade levels, dry-run idempotent publication prevention, and controlled append-only audit. GitHub Actions run 43146086335 passed 375 tests, 0 failures, 80 assets and Wrangler dry-run.

Remaining before production: (1) Confirm new Cloudflare version actually deployed at signal-chart.auxwork3.workers.dev and cron was accepted by Cloudflare Free; (2) On staging only, explicitly enable SC_AUTO_RESEARCH_ENABLED when ready to review cloud CPU limits (Workers Free Cron CPU 10ms) and provider-rate budget; (3) verify actual futures and calendar provider availability from the live Cloudflare edge, plus the resulting Supabase scan logs; (4) choose either native Cloudflare Cron or the currently inactive Supabase pg_cron as the single scheduler; (5) implement and separately security-test durable per-hour idempotency, reliable paid-signal publication behind the existing sc_auto_signal_control.enabled DB kill switch, evidence/audit, backtesting, and safe forex executable feed; (6) DO NOT enable SC_AUTO_PUBLISH_ENABLED or premium unlock by this staging change.

Important: A green GitHub build is not proof of verified real trades, active hourly scanning or publishable performance. The scanner remains dry-run and disabled by default. No DNS, payments, trial policy or customer entitlements were changed.


## 2026-11-12 — Live hourly scanner verified, source-level diagnostics and exchange isolation

Verified using the user's connected Supabase database (read-only SELECTs) and pg_net probes to staging Worker:
- Cloudflare native research Cron runs in 4 slots at UTC minutes 07,08,09,10. The legacy Supabase signalchart-hourly-auto-scan job remains disabled. Calendar fetch/ingest jobs are active.
- Real sc_auto_scan_runs rows at 07,08,09 UTC on 2026-11-12 confirm all 4 hourly shards and audit persistence. For 09:00 UTC: 11 symbols scanned, 7 DATA_UNAVAILABLE, 4 NO_SETUP, zero qualified, zero published. Thus execution and audit exist, but the unattended signal PRODUCT is not production-ready.
- public.sc_auto_signal_control.global enabled=false; Cloudflare status reports researchEnabled=true, publicationEnabled=false and publicationRouteConfigured=false.
- Live GET /api/candles?market=crypto&symbol=BTCUSDT&interval=1h and ADAUSDT&interval=1h returned HTTP 200 with 240 actual Bybit USDT linear perpetual candles each. Follow-up ADA probe exposed exchange='bybit', source='Bybit USDT linear perpetual', instrument='perpetual' and no quote alias. This proves Cloudflare currently reaches at least Bybit for public candles; it does not prove identical performance from all scanner shards or successful signal qualification.
- User-facing terminal previously accepted Binance WebSocket tick/candle updates on a Bybit perpetual series. Fixed market-charts.js to allow Binance live kline updates only for Binance exchange perpetuals. Selected non-Binance candles/quotes are not overwritten by Binance miniTicker; Bybit/OKX charts refresh directly from own source every 120 seconds when visible. cloudflare/market-candles.mjs now supplies explicit `exchange` on all responses.
- cloudflare/auto-scanner.mjs now attaches safe diagnostic codes and source provenance per market; cloudflare/scan-audit.mjs stores only strictly allowlisted {market,symbol,status,source,diagnostic} arrays (max 24) in private sc_auto_scan_runs metadata. This will reveal failure reasons on future normal Cron runs without exposing source error text, trade prices, secrets or customer data.
- CI run 43193559160 passed 398 tests, 0 failures and Wrangler dry-run; tests/cloudflare-scan-diagnostics.test.js and tests/cloudflare-candle-venue-isolation.test.js cover these new guards.

Outstanding engineering: inspect next private scan runs' metadata.marketChecks after Cloudflare rollout and normal cron (no need to manually invoke signed private endpoints); repair high-frequency DATA_UNAVAILABLE sources and validate 4h strategy continuity on fresh perps; verify FX provider still has major coverage gaps and economic calendar SINGLE_SOURCE_WEEKLY is research-only, NOT publication-approved; obtain independently checked event source and actual executable forex feed before expanding forex signals; implement backtesting and idempotent secure publication with production authorization, not during staging. Keep customer payments/trials and signalchart.pro cutover unchanged.


## November 12 — verified deployment blocker and hourly scan status
- GitHub QA run 43219288278 succeeded on f69223331d096b71a6e3bfed6c624e2bcdb7159b. Deployment run 43219288572 failed because CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN resolved empty as GitHub Actions repository secrets. Deployment step skipped. Configure repository Actions secrets privately; environment-only secrets do not reach the current workflow.
- Failed deployment job still passed 425 tests and built 84 allowlisted assets. Public read-only smoke: health 200 PASS, ready 503 PASS, root OLD_DEPLOYMENT, launch asset UNREACHABLE, mobile app UNREACHABLE, markets 200 with 77 entries, BTC and ADA 200 with 240 OKX perpetual candles each, EURUSD 502. Verdict STAGING_REQUIRES_ATTENTION, 5/9 checks passed. New branch changes are not live.
- Read-only Supabase scan audit: 12:00 UTC had four shards, 11 scanned, zero qualified, zero published, seven errors; 11:00 UTC four shards, 11 scanned, zero qualified/published, five errors. Research scanning runs but is not signal-production ready.
- Next: authorize Cloudflare staging deploy credentials without committing them, deploy to workers.dev only, rerun smoke, investigate private per-symbol diagnostic codes and FX feed. Historical Blob reconciliation remains required. No payments, trials, premium publication, production DNS changes or paid services.
