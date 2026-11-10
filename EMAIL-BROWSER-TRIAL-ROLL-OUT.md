# SignalChart — Privacy-first email and browser free-trial protection

Status: **Implemented in staging source and Supabase migration applied; not activated or deployed.** Date: 2026-11-10.

## Customer flow

1. Create account using Supabase Auth and verify email (no phone number or WhatsApp).
2. Open Account → Activate free trial. Complete free Cloudflare Turnstile anti-bot challenge.
3. The backend sets a long-lived, Secure, HttpOnly, SameSite=Lax, host-only signed first-party browser cookie (not a hardware fingerprint), HMACs its random ID, and atomically claims it in Supabase.
4. A confirmed email with no previous trial history receives exactly **72 hours** and **3 distinct crypto/forex signal unlocks**. Previously unlocked signals can be reopened until the 72-hour expiry.
5. A new account using the **same retained browser cookie** is denied another trial. Shared IPs only increase a risk score; they do not automatically cause a permanent ban.
6. Repeated trial claims for the same verified UID are rate limited; network IP data are HMACed before storage. Expired network risk records have an opportunistic bounded cleanup on new activation attempts.

## Privacy and anti-abuse limits

- Never collect personal WhatsApp contact details or SMS/WhatsApp OTP, hardware IDs, canvas fingerprints, GPS, or device contacts for the free-trial path.
- A browser cookie is **not** a permanent device identifier. Clearing site data, private browsing, using another browser/device, or using a VPN can bypass portions of this system. It deters casual repeat trials but **cannot guarantee one trial per human**.
- Many users share campus, family, café or office IP addresses. IP matching must never be the only criterion for permanent trial denial.
- Recognized browser-claim HMACs persist to prevent replay, even if an Auth account is deleted. Risk-event records expire after up to 30 days for new browser attempts and are opportunistically pruned; a scheduled data-retention job will be needed for a strict deletion deadline.
- Offer a clear appeal/manual review path for legitimate shared devices and older users.
- User identity, IP/cookie HMACs and private premium data are stored by backend and Supabase service role, not exposed via browser SQL or public feeds.

## Changes made

- `supabase/migrations/20261110110000_sc_email_device_trial.sql`: additive browser-claim table, altered proof-method fields preserving existing phone trials, role-restricted RPC, HMAC network-risk history and bounded expiry cleanup.
- `lib/trial-gate.js`: signed browser cookie, verified-email checks, historical trial eligibility guard, action-specific mandatory Cloudflare Turnstile Siteverify, atomic service-role activation.
- `api/trial.js`: authenticated `GET action=device`, `POST action=activate_browser`.
- `api/config.js`: verified-email browser trial method and truthful readiness, never exposes Turnstile secret.
- `account.html`, `signals.html`, `sc-trial-ui.js`, `candriva-v2.js`, `api/premium-signals.js`: phone-free onboarding and browser activation. Trial HTTP API explicitly sends same-origin signed cookies.
- `tests/email-device-trial.test.js`, `tests/trial-postgres.integration.mjs`, `tests/whatsapp-visibility.test.js`: signed-cookie and anti-bot negative tests, browser/IP/UID uniqueness, transaction SQL constraints and customer UI contract.
- Historical WhatsApp OTP backend remains disabled and available only for audit/legacy compatibility until it can be safely retired.

## Setup required before a live trial rollout

1. **Completed:** Cloudflare Turnstile `SC_TURNSTILE_SITE_KEY` and `SC_TURNSTILE_SECRET_KEY` variables exist under staging Preview, branch `signalchart-recovery-staging`, with Sensitive type. The secret contents were not inspected. Confirm the Cloudflare widget permits the actual next preview hostname. Documentation: https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/
2. **Completed 2026-11-10:** Applied migration `signalchart_email_device_trial_20261110` to the connected Supabase project `nnailvcgaupjtdaxvjsx`. Verified private browser-claim table + service-only activation RPC + RLS. `anon` and `authenticated` cannot select claims or execute the RPC. Existing count: 0 trials, 0 browser claims, 0 paid records; 1 legacy hold preserved. This DB is also used by production, so avoid destructive QA.
3. **Partially completed:** Vercel staging has environment entries for `SC_TRIAL_HMAC_SECRET`, `SC_TRIAL_ROLLOUT_AT` and server-only Supabase credentials. Their values and runtime behavior have not been verified end to end; confirmed the existing historical hold remains untouched.
4. **Pending:** Deploy staging **only** within the existing five-assistant-deployments-per-24-hours budget; perform real browser/Turnstile end-to-end checks, shared-IP fairness, duplicate account controls, cookie integrity, expiry, and payment/admin isolation.
5. **Pending:** After staging release and complete end-to-end verification, enable `SC_EMAIL_DEVICE_TRIAL_ENABLED=true` for staging first; never switch production on without QA and release authorization.
6. **Pending:** Existing release integrity gate still blocks commercial production launch: **11 original deployed files remain SHA-unverified**. Do not represent the web customer experience or Android apps as production ready.

## Safety switches

Staging branch Vercel env **SC_EMAIL_DEVICE_TRIAL_ENABLED=false**, set explicitly. All user-facing activation is blocked until the complete feature is configured. WhatsApp message sending, manual payment collection and automatic signal publication remain disabled; no new Vercel deployment performed in this step.

## Latest independent checks — 2026-11-10

- Connected Supabase migration applied successfully and listed in migration history; no customer data was created during application.
- RLS on `sc_browser_trial_claims`: enabled; `anon` and `authenticated` have no SELECT access; neither can invoke `sc_activate_browser_trial`. Service role alone has these privileges.
- Existing automatic signal scanner and scheduled cron both remain disabled.
- Full isolated test run: **153 passed, 0 failed**. Release integrity gate: **93 restored original files, 11 original files unverified**.
- Security advisor: 15 information-level no-policy findings on intentionally private server-only tables, plus a pre-existing warning for Auth leaked-password protection. Ref: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- **Zero** deployments were initiated for the migration and QA. The existing preview does not yet contain the newly implemented browser trial UI.

## Source provenance blocker — recovery tool added 2026-11-10

The original Vercel CLI-uploaded deployment `dpl_7V8tjUnDnMNAmW1xAwBZUYvMRfzD` exposes the hashes of all **104 original source files**, but the connected source-file reader truncates each of the **11 missing files** to approximately 2,000 base64 characters. A partial prefix is **not** enough to reproduce or authenticate original bytes. The previously reconstructed 11 modules must not be marked as original and must not be substituted for evidence.

To resolve this without overwriting current staging work, `scripts/recover-missing-originals.mjs` uses the full Vercel Source API (read only), requires a **locally configured** `VERCEL_TOKEN`, and SHA1-validates each complete file against the untouched `recovery-manifest.json`. It stores verified originals under the existing Git-ignored `vercel-recovered/original-missing/` directory, never alters application routes, and never commits credentials. Do not paste API tokens in a chat or commit these originals before security review. GitHub file: https://github.com/AdanKhanSwati/signal-chart/blob/signalchart-recovery-staging/scripts/recover-missing-originals.mjs

No complete originals have been recovered via that script in the connected workspace yet; **the original-source gate is intentionally still failing**. After full recovery, compare the original code with the 11 modern staging replacements, review the differences in auth, permissions, payment approval, and storage behavior, and re-run the full test suite before any launch. A test pass alone is not a substitute for that provenance review.

The self-imposed Vercel budget remains **no more than five assistant-initiated deployments per rolling 24 hours across projects**; there were more than five recent deployments in the account, so this source audit did not initiate a new preview or production deploy. Trial activation remains disabled.


## Security hardening — 2026-11-10 (additional staging commits)

- Legacy phone/WhatsApp trial verification now fails closed whenever phone delivery is disabled or the new browser trial is active. Direct calls to the phone verification and already-verified-phone endpoints cannot bypass the new flow.
- Turnstile is rendered **only after the signed-in trial panel is visible**, including asynchronous Account sign-in transitions. Avoids zero-width/hidden CAPTCHA widgets on mobile.
- Cloudflare Siteverify must return success, action `trial_activate`, **and the exact hostname of the inbound trial request**. Rejections happen before the browser-claim SQL function is called. Official documentation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Application code now recognizes **only** `SC_TURNSTILE_SITE_KEY` and `SC_TURNSTILE_SECRET_KEY`, not older misspelled aliases; both canonical keys were already created in staging Preview.
- A missing signed browser cookie receives HTTP **428** rather than a generic 500.
- Latest complete isolated suite before the canonical-key regression case: **161 passed / 0 failed**. Subsequent focused canonical-key regression checks: **17 passed / 0 failed**. Release integrity gate remains **93/104 original files verified, 11 unverified**.
- No production changes, no live trial claims, and no Vercel deployments in this hardening step. `SC_EMAIL_DEVICE_TRIAL_ENABLED` stays `false`.


## Additional staging QA and account-session hardening — 2026-11-10

- Executed the **actual connected Supabase PostgreSQL** browser-trial RPC inside an explicit `BEGIN; ... ROLLBACK;` transaction with four generated synthetic Auth users. Verified one 72-hour email/browser activation, same-browser second-user denial, same-user replay detection, shared-network legitimate second-user activation, and unverified-email rejection. Permission checks remained correct. After rollback, independently verified zero `@qa.invalid` test users, zero trial records, zero browser claims, zero risk records, zero paid access records; the existing one historical trial hold remained unchanged.
- Added `tests/trial-browser-lifecycle.test.js` with executable VM simulations of authenticated UI: hidden account panel, later reveal (mobile-friendly), anti-bot widget rendering once, disabled-state fail-closed, and signed-out state. These are browser-script simulations, **not an actual cloud-hosted browser E2E test**.
- Both `candriva-v2.js` and `sc-trial-ui.js` now obtain a single shared Supabase GoTrue client through the same in-page async registry (`window.__scSupabaseAuthClient`), avoiding duplicate instances competing over refresh-session storage or duplicate script downloads. The registry checks project URL + public key, uses a shared load Promise, and deletes failed attempts for retry. The trial UI accepts existing authenticated sessions without creating an extra client.
- Full fresh isolated test run at commit `99e5b70` was **168 passing, zero failing**. Release gate still protects the 11 unrecovered original sources (93 verified/104 total), with no unexpected recovered-file changes.
- No preview or production deployment was initiated. The already deployed preview predates these fixes. `SC_EMAIL_DEVICE_TRIAL_ENABLED` remains `false`, and the live production website was not altered.
