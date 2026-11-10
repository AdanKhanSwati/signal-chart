# SignalChart — Privacy-first email and browser free-trial protection

Status: **Implemented in staging source; not activated or deployed.** Date: 2026-11-10.

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

1. Create a **Cloudflare Turnstile Managed** widget (free plan) restricted to the intended SignalChart staging host and, later, production domain. Configure `SC_TURNSTILE_SITE_KEY` (public) and `SC_TURNSTILE_SECRET_KEY` (encrypted and server-only) directly in Vercel. Never send the secret through chat or place it in GitHub. Documentation: https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/
2. Review, backup, test and apply the additive migration to the connected Supabase project. It has passed an isolated PGlite PostgreSQL test but **has not been applied to the live project**.
3. Confirm `SC_TRIAL_HMAC_SECRET` (random server-only secret, at least 32 characters), `SC_TRIAL_ROLLOUT_AT`, server-only Supabase credential, and approved hostname list. Preserve any existing historical trial holds.
4. Deploy the staging commit **only when the existing five-assistant-deployments-per-24-hours budget permits** and re-test same-browser duplicate accounts, shared-IP legitimate customers, signed-cookie integrity, Turnstile replay, expiry, and payment/admin isolation.
5. After complete end-to-end staging verification, enable `SC_EMAIL_DEVICE_TRIAL_ENABLED=true` for staging first; never switch production on without QA and release authorization.
6. Existing release integrity gate still blocks commercial production launch: **11 original deployed files remain SHA-unverified**. Do not represent the web customer experience or Android apps as production ready.

## Safety switches

Staging branch Vercel env **SC_EMAIL_DEVICE_TRIAL_ENABLED=false**, set explicitly. All user-facing activation is blocked until the complete feature is configured. WhatsApp message sending, manual payment collection and automatic signal publication remain disabled; no new Vercel deployment performed in this step.
