# SignalChart Cloudflare Free staging

This is an **incomplete migration staging configuration**, not a customer-ready
production release. No work in this folder should be used to change the
signalchart.pro DNS zone until the complete launch checks have passed.

## What is implemented

- Existing website's 78 reviewed static assets are built to `.cloudflare-dist`.
- Cloudflare Workers Fetch API serves the static files and these paths:
  - `GET /api/health`
  - `GET /api/config`
  - `GET /api/member?action=me` (verified Supabase session and private profile, trial and paid-SQL reads; historical Vercel Blob entitlements still awaiting reconciliation)
  - `GET /api/trial?action=state`
  - `GET /api/trial?action=device` (disabled until all trial configuration secrets are present)
  - `POST /api/trial?action=activate_browser` (disabled until reviewed rollout and Cloudflare Turnstile are configured)
  - `GET /api/markets` and `GET /api/candles?action=markets` (public forex/crypto discovery, bounded public Binance query and fallback)
  - `GET /api/candles?market=crypto&symbol=BTCUSDT&interval=15m` (public Binance futures OHLC)
  - `GET /api/candles?market=forex&symbol=EURUSD&interval=15m` (Yahoo indicative FX candles; never assert these are broker-executable).
  - `GET /api/research?mode=health|news|calendar` (source-attributed, bounded, fail-closed public economic research; paid backtests remain unavailable).
- Unported `/api/` routes fail closed with HTTP 503. Payment collection,
  administrative payment decisions, live signal publishing and historical
  paid backtests have **not** been ported. Premium unlock exists behind a
  default-off reconciliation flag; private customer support has been ported.

## Safe checks (no Cloudflare account required)

From the repository root, Node 22+:

```sh
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
node --test tests/*.test.js
node scripts/build-cloudflare-static.cjs
npx --yes wrangler@4 deploy --dry-run --config cloudflare/wrangler.staging.json --outdir /tmp/signalchart-worker-dryrun
```

The GitHub Actions workflow `cloudflare-migration-qa.yml` runs these checks
without deploying anywhere. The migration branch MUST NOT trigger Vercel.

## Only after Cloudflare access is connected

- Select Workers **Free**; do not upgrade.
- Use a separate `workers.dev` staging deployment. Keep signalchart.pro DNS
  unchanged while the protected APIs and historical access records remain incomplete.
- Add the following via Wrangler secrets or the Cloudflare dashboard — never
  store values in GitHub, `.dev.vars` tracked files, chat, or static assets:
  - `SUPABASE_URL` — existing project URL
  - `SUPABASE_PUBLISHABLE_KEY` — browser-safe project key
  - `SUPABASE_SECRET_KEY` — server-only secret key with database privileges
- Trial activation stays off unless these are also configured and verified:
  - `SC_EMAIL_DEVICE_TRIAL_ENABLED=true`
  - `SC_TRIAL_HMAC_SECRET` (>=32 chars; preserve previous secret where applicable)
  - `SC_TRIAL_ROLLOUT_AT` (review against historical account creation dates)
  - `SC_TURNSTILE_SITE_KEY`, `SC_TURNSTILE_SECRET_KEY` (hostnames registered for
    the actual staging or production domain; Siteverify enforces hostname + action).
- Test with a **new disposable email verified against the staging hostname**
  without impersonating or altering an existing customer, and confirm the
  historical-account trial lockout, auth isolation, and private SQL grants.
- Keep payments and real signal publication disabled until the remaining APIs,
  audit records and external data feeds have been migrated and security reviewed.

## Production cutover blockers

1. Historical private Vercel Blob store `candriva-private-accounts` remains suspended.
   Recover/reconcile existing entitlements, manual payment requests and receipts
   without granting unwarranted premium or repeating old free trials.
2. Admin billing/review, receipt migration, historical premium reconciliation,
   automated research and paid backtesting are not yet ported or validated.
   Existing support and gated premium unlock do not establish production readiness.
3. Perform a browser-based signed-in E2E smoke test on the Cloudflare staging
   URL, including trial action, 3 unique unlocks, expired trial, failed
   payment path, admin restrictions, signup email and mobile layout.
4. User approves DNS connection AFTER verification. Do not edit the existing
   Cloudflare zone's Hostinger A/CNAME records or any MX/TXT email records
   during development.

The free tier has finite CPU and request allowances. Large market-analysis jobs
must be redesigned for the free limits rather than running inside a synchronous
Worker request.

## November 11, 2026 — additional tested staging routes

- `GET /api/premium-signals?action=list` is a public, field-allowlisted teaser feed; `POST /api/premium-signals?action=unlock` requires verified Supabase Auth. Its paid entitlement comes only from unrevoked, approved SQL records. A free trial unlock uses the existing transactional `sc_unlock_trial` RPC, which prevents a fourth unique signal while permitting reopening the first three before expiry. **Both are gated by `SC_PREMIUM_UNLOCK_ENABLED=true`; the default is disabled while legacy entitlements remain unreconciled.**
- `GET /api/cv-ops?action=me` returns the verified customer's membership and support inbox, with no payment-collection facility. Historical payments are represented as migration-pending, not falsely claimed absent.
- `GET /api/cv-ops?action=messages&ticketId=...` reads only a ticket owned by the verified user. `POST /api/cv-ops?action=new_ticket`, `reply`, and `close_ticket` use private, rate-limited Supabase support RPCs. Server-only `SC_SUPER_ADMIN_UID` optionally permits a verified staff member to access another user's support conversation; user-editable metadata cannot grant this.
- New database migration `database/sc-support-messages.sql` applied to Supabase project `nnailvcgaupjtdaxvjsx` as `sc_support_messages_phase_two`. Both support tables have RLS enabled with no direct `anon` or `authenticated` access; all three support functions explicitly deny browser-role execution. Privilege checks passed.
- On the staged billing page, payment wallet, QR, payment submission, and BTC quote remain hidden when `checkout.enabled=false`. The page clearly warns not to send funds while historic records are reconciled. `/api/checkout` and all payment writes still fail closed.
- GitHub Actions run `42954286299` passed **255/255 tests**, with a successful Wrangler 4 dry-run compiling the Worker and 78 static assets. No actual Cloudflare staging or production deployment has occurred.

Next: migrate **administrator billing, historical payment/receipt reconciliation, signal analysis and news/calendar backend**, then connect Cloudflare staging credentials and run live customer/admin E2E QA before production domain cutover. Never deploy `signalchart.pro` as a paid site before these checks.

## Read-only economic research (November 11 continuation)

- `GET /api/research?mode=health` reports that unattended signal publishing is disabled.
- `GET /api/research?mode=news` retrieves bounded, dated RSS/Atom headlines from the Federal Reserve and U.S. BLS. Links are restricted to those official source domains; malformed links fall back to the official source page.
- `GET /api/research?mode=calendar&symbol=EURUSD` merges bounded official BLS release-calendar entries and attributed Forex Factory weekly events, includes current news, and fails closed with UNKNOWN or PARTIAL_US coverage when sources are unavailable/stale. The calendar never asserts a safe trading window from missing data.
- `GET /api/research?mode=backtest` remains HTTP 503: paid research simulation has not been safely ported to the free Worker runtime. No premium signal generation or automated publishing was enabled.
- The feeds use fixed HTTPS origins, 350 KB per-response caps, short timeouts, isolated 2–15 minute caches and no user-controlled upstream URL. Real provider reachability and browser QA remain unverified until a staging deployment exists.
