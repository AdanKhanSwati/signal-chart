# SignalChart research-only preview: release gates (2026-11-13)

This document is an evidence checklist, **not** an approval to launch or a claim that the current Worker is healthy.

## Scope and controls

- Allowed: read-only public research pages, market catalog, indicative chart references with clearly identified source and instrument, and anonymous authorization-denial tests.
- Not allowed without independent sign-off: production DNS cutover, Vercel deployments, paid infrastructure, payment processing or reconciliation writes, trials, premium entitlements, automatic paid signal publication, or live trading recommendations.
- Never reinterpret Coinbase spot references as USDT perpetual candles. An instrument/provider mismatch fails the perpetual-data gate even when HTTP returns 200.
- Never silently substitute indicative/daily FX data for requested 15-minute historical FX candles. Unavailable or stale FX data must remain explicitly unavailable.
- Keep `productionReady: false` and publication disabled until all relevant gates below pass. A passing public smoke does not authorize commercial operations.

## Verification checklist

| Gate | Evidence required | Status at documentation time |
| --- | --- | --- |
| Current branch | Record SHA and green regression/build workflow for that exact SHA | Unverified; earlier workflow predates current branch |
| Worker deployed revision | Match deployed assets and Worker to tested commit | Unverified |
| Public health | Fresh GET `/api/health` and `/api/ready`, capture response status and timestamps | Unverified: direct environment DNS lookup failed |
| Read-only staging smoke | Run `node scripts/check-live-staging.cjs` from network-capable CI and review **all** checks, including anonymous admin denial | Unverified for current branch |
| Crypto perpetual history | Exchange, instrument, timestamp continuity, OHLC integrity, freshness and no spot alias for representative and long-tail pairs | Blocked by prior spot-reference fallback and intermittent incomplete feeds |
| Forex history | Independent source, interval integrity, market-hours freshness and 15m candles for EURUSD/GBPUSD/USDJPY | Blocked by unavailable provider in previous smoke/scan |
| Scanner and news | Several consecutive hourly scans with source-level diagnostics, event/news coverage, fail-closed behavior and zero unauthorized publication | Not established |
| Customer/admin auth | Browser/device tests for anonymous denial, role isolation, session expiry, refresh, logout and cross-user access | Not established on live deployed revision |
| Mobile PWA/Android | Device tests for viewport, chart gestures, install/update, login return, offline recovery and signed-app asset association | Not established; Android scaffolding is not a release |
| Billing and legacy state | Independent transaction-to-entitlement reconciliation, revoked/expired handling, audit trail, abuse controls | Not established; do not activate |
| Signal performance | Independently reproducible backtesting with fees/slippage, drawdowns and forward-test evidence | Not established |

## Next safe sequence

1. Confirm the actual SignalChart Supabase project identity before any SQL. A connected project bearing an unrelated display name must not be modified on assumption alone.
2. Run fresh read-only GitHub-hosted smoke against the Worker and correlate its deployed revision to the branch SHA; treat a local DNS failure as **unverified**, not proof of outage.
3. Fix provider-specific data integrity with mocked and historical regression fixtures before staging deployment. Never turn a reference feed into a verified signal feed by relabeling.
4. Complete authenticated QA and reconciliation independently. Only then reassess commercial release.

**Decision: commercial launch blocked. Research-only staging is not verified against the current branch.**
