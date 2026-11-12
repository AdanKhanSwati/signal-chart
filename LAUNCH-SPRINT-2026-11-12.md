# SignalChart — 24-hour launch sprint, 12 November 2026

## Launch decision right now

**NOT approved for paid customer launch. A research-only public preview is possible after the staging deployment is current and its public routes and account flows pass live QA.** Do not equate a green CI run with deployed functionality or independently tested signal outcomes.

GitHub source of truth:
- Repository: `AdanKhanSwati/signal-chart`
- Branch: `signalchart-cloudflare-free-migration`
- Live Worker staging URL: `https://signal-chart.auxwork3.workers.dev`
- Production domain: `signalchart.pro` (leave untouched until approval)
- Public read-only staging verification: `node scripts/check-live-staging.cjs`
- Cloudflare compile check: `npx wrangler@4 deploy --dry-run --config cloudflare/wrangler.staging.json`

## Implemented during this launch push

1. A dedicated source-attributed public landing page `launch.html`, `launch.css`, `launch.js`; the Cloudflare Worker routes requests for `/` to that page once deployed. Portal and account links remain available at `/dashboard.html` and `/account.html`.
2. Customer mobile web app now fetches supported `/api/candles` history instead of the Cloudflare-unported `/api/quotes?market=crypto`; currency labels distinguish USD reference pricing from USDT futures. Clear source and error labels replace invented 24-hour changes.
3. Customer PWA registration is scoped to `/app.html`; administrator Web Push SW is separately scoped to `/ops.html`. This is not a compiled or Play-distributed native Android app.
4. Cloudflare Worker provides `GET /api/fx-daily-reference?symbol=EURUSD`: authentic published, keyless Frankfurter daily reference points, never OHLC or live broker prices. When intraday broker OHLC fails, the market terminal can show a daily line clearly labeled as a historical reference and keeps premium/technical indicators unavailable.
5. GitHub Actions runs a read-only public Cloudflare smoke after source tests, asset export and Wrangler dry-run. Probe outcomes are NON-GATING diagnostics, not production deployment permission.

## Confirmed live evidence as of ~12:17 UTC, 12 November

Live-read through GitHub Actions runner on `signal-chart.auxwork3.workers.dev`:
- `/api/health`: 200, healthy process.
- `/api/ready`: 503, productionReady false as intended.
- `/`: 200, still OLD dashboard deployment (not the new landing).
- `/launch.html`, `/app.html`: unreachable from smoke runner; NOT verified deployed.
- `/api/markets`: 200, 77 market metadata entries at probe time.
- BTCUSDT and ADAUSDT hourly history: 200 but from **Coinbase USD spot reference**, not Binance/Bybit/OKX verified USDT futures.
- EURUSD 15-minute history: 502, forex candle source unavailable.
- Existing Supabase Cron/Cloudflare research scan logs showed 4 shards per hour, 11 markets sampled, reported partial source failures, zero qualified and zero published in most recent checks. `public.sc_auto_signal_control` global enabled=false.
- `public.sc_legacy_recovery_items`: zero rows; `public.sc_legacy_evidence_copies`: zero rows; `public.sc_paid_access`: zero rows. Historical Vercel Blob ownership/payment data is still not reconciled.

The new daily reference endpoint and frontend fallback were committed **after** that smoke, so they have NOT been live-verified.

## Research-preview acceptance gates

- [ ] New `/` landing page and `/launch.html` actually serve the latest deploy, including correct SignalChart wordmark, portal navigation and risk disclosure.
- [ ] Customer `/app.html`, `/terminal.html`, `/account.html`, `/support.html` load on Android Chrome over both Wi-Fi and mobile data. PWA installation works without interfering with administrator SW.
- [ ] Market metadata shows both crypto and forex symbols, with correct quote/base labels. Selected prices clearly distinguish Binance/Bybit/OKX futures, Coinbase USD spot references and Frankfurter published daily references.
- [ ] Forex `/api/candles` failures do not trap visitors on a spinner: true OHLC appears if available; otherwise a clearly identified daily reference line or an explicit unavailable message.
- [ ] Responsive chart numbers and touch controls are visible without horizontal overflow, spinner loops or auto-scroll regression.
- [ ] Real signed-in user and super-admin journeys pass isolation and data-privacy tests; unavailable billing does not display actionable wallet instructions.
- [ ] All source regression tests, Cloudflare Worker dry-run build and live staging smoke pass relevant PUBLIC gates. A readiness 503 is EXPECTED until full commercial launch.

## Additional mandatory PAID launch gates

- [ ] Recover and reconcile historic Vercel Blob account/payment/trial records, including source provenance and payment/ownership verification; no false premium grant or trial reset.
- [ ] Complete secure payment submission, chain verification, authenticated super-admin approval/rejection, private receipt storage and independent live QA before enabling crypto transfers.
- [ ] Complete historical real-market backtesting with dated data, realistic spread/fees/slippage, independent performance verification and non-misleading disclosures.
- [ ] Establish reliable broker/exchange-specific OHLC and fresh news/economic-event coverage, including all intended forex pairs. Daily Frankfurter rates DO NOT qualify for automatic FX signal publication.
- [ ] Complete durable idempotent hourly signal publication with audited independent review and clear performance monitoring. All current research dry-runs publish zero premium signals by design.
- [ ] Finish and test any actual native Android customer/admin binaries and applicable Google Play billing compliance. Existing browser-installable PWAs are not native APKs.
- [ ] Review privacy, auth/RLS, antifraud limits, backup/recovery, rate limiting, secrets and terms; final product-owner approval before production DNS/cutover.

## Safe deployment blocker

GitHub pushes here DO NOT publish to Cloudflare on their own; the latest staging smoke still found the old release. A person with authorized access to the user's Cloudflare account must confirm the Worker project is connected to this branch and trigger a new staging deployment or use Wrangler with account credentials stored privately. Do not commit Cloudflare tokens. Do not change the production domain or enable paid plans. After deploying, rerun `node scripts/check-live-staging.cjs` in an internet-enabled runner and complete Android browser QA.

## Next sprint execution priorities

1. Establish a current Cloudflare staging deployment of this branch without spending or changing production DNS.
2. Verify the real FX daily-reference endpoint from Cloudflare edge; fix only demonstrably broken provider paths.
3. Validate PWA pricing/source attribution and the signed-in customer/admin flow on Android.
4. Diagnose scanner `INCOMPLETE_SOURCE` and forex `PROVIDER_UNAVAILABLE` without loosening closed-candle or provenance requirements.
5. Do not bypass release gates merely to meet the one-day deadline. If live data and billing are blocked, deliver a truthful limited research preview and an explicit remaining-work list.
