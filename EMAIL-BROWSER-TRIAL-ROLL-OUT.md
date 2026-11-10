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
