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
- All OTHER `/api/` routes fail closed with HTTP 503. Payment collection,
  administrative payment decisions, live signal publishing, premium unlock,
  billing reviews and existing support operations have **not** been ported.

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
2. Premium signal preview/unlock, admin, billing, support and automation APIs
   are not yet ported. Never claim production readiness based on public charts
   alone.
3. Perform a browser-based signed-in E2E smoke test on the Cloudflare staging
   URL, including trial action, 3 unique unlocks, expired trial, failed
   payment path, admin restrictions, signup email and mobile layout.
4. User approves DNS connection AFTER verification. Do not edit the existing
   Cloudflare zone's Hostinger A/CNAME records or any MX/TXT email records
   during development.

The free tier has finite CPU and request allowances. Large market-analysis jobs
must be redesigned for the free limits rather than running inside a synchronous
Worker request.
