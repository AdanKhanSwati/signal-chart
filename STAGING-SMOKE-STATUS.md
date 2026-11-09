# SignalChart staging API integration smoke — November 10, 2026

## Result

**PROTECTED PREVIEW: READY (HTTP smoke passed for public-safe routes).** This is not authorization to launch or to enable autonomous publication.

Vercel project: `candriva-signals-beta`  
Preview deployment ID: `dpl_8poTM63DJs9p9VGykNQRJFLwcXri`  
Deployed source SHA: `0418eb30a29ec02cb56e858f9681d5e5e69b55dd`  
Protected preview host: `candriva-signals-beta-8k9b5knfl-adan-khan-swati-s-projects.vercel.app`

- First preview failed: Vercel Hobby 12-function deployment limit against 17 entrypoints.
- Second preview failed: a stale explicit `api/signals.js` function configuration after consolidation.
- Third preview succeeded with 12 deployed API entrypoints. Six original URL handlers are bundled behind one allowlisted `/api/compat` entrypoint, with the original API source preserved in Git for audit.
- Staging controls verified by `GET /api/config`: 72-hour trial, 3 unique unlocks, authReady true, paymentsEnabled false, signalsEnabled false, WhatsApp OTP delivery false.
- `GET /api/research?mode=health` → HTTP 200, automation not activated.
- `GET /api/premium-signals?action=list` → HTTP 200, empty signal list (zero signals published).
- `GET /api/crypto`, `/api/forex`, `/api/signals` → HTTP 200, compatible nonactionable signal previews.
- `GET /api/candriva` → HTTP 410, retired custom-password API.
- Unknown `/api/compat?sc_route=...` → HTTP 404.
- `GET /api/checkout?action=quote` → HTTP 200, live Coinbase reference quote, not a payable invoice.
- `GET /api/quotes?market=crypto` → HTTP 200, 10 reported symbols with Binance futures source.
- `GET /api/quotes?market=forex` → HTTP 200, 38 indicative currency pairs with Open ER API source.
- `GET /api/market-detail?market=crypto&symbol=BTCUSDT&interval=1h` → HTTP 200 with 240 hourly OHLC candles.
- `GET /api/candles?action=markets` → HTTP 200, live exchange market catalog.
- `GET /api/research?mode=calendar&symbol=EURUSD` → HTTP 200, full-week coverage.
- `GET /signals.html`, `/billing.html`, `/admin.html` → HTTP 200.

## Limits and release blockers

**NO PUBLIC RELEASE.** The above are read-only, public-safe HTTP checks; they do not prove authenticated customer journeys or private Blob storage integrity.

1. The 11 original Vercel server/test files remain SHA-1 unverified. The source-integrity release gate is still BLOCKED. Reconstructed replacements have isolated test coverage, but original bytes are unavailable from truncated download responses.
2. Real customer Supabase login, 72-hour trial activation/expiry, same-number abuse prevention, and reopen-after-3 unlocks need session-based staging end-to-end tests.
3. Private Blob storage write/read, payment screenshot privacy, duplicate transaction rejection, admin review and real chain verification require dedicated non-production test records and audit.
4. Supabase Auth password leak detection, automated publishing feed reliability, historical performance validation and Android app implementations remain release blockers.
5. Preview relies on existing shared provider configuration; all trial OTP sending, payment collection, and scheduled publishing remain OFF. Do not run destructive/payment tests against shared live users.
6. Vercel Hobby does not support commercial paid deployment. Choose compliant hosting for the final launch.

Last isolated full suite before this preview build: **134 tests passed, 0 failed**. Follow-up scripts are provided in `scripts/staging-smoke.cjs` to repeat read-only checks. Protected previews may require `VERCEL_AUTOMATION_BYPASS_SECRET` in the execution environment.

**Production remains unchanged.** Supabase hourly cron is inactive; `sc_auto_signal_control.enabled` remains false; no premium signals are published.
