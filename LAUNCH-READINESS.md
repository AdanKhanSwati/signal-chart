# SignalChart release readiness

Status: **BLOCKED — NOT DEPLOYABLE**. This branch is source recovery and fixes, NOT the production website.

- Original deployment source: 85 of 104 files recovered with SHA-1 verification.
- Missing: 17 original backend/test modules + 2 PNGs; see recovery-manifest.json.
- GitHub project is publicly visible. Make it private before releasing proprietary server code.
- Production API reported Supabase configured, signals enabled, payments disabled, and hourly signal generation on-demand, not unattended (2026-11-09).
- Corrected 72-hour trial entitlement and customer-facing wording here; new isolated tests included. The live environment is NOT updated.
- Git auto-deploy for this recovery branch is disabled using Vercel git.deploymentEnabled to avoid deploying partial code.

Required before launching: complete/replace missing backend securely; verify user/admin roles, password/reset, billing approval/rejection and no-payment lock; validate economic data and hourly jobs; independently backtest signals and risk controls; verify responsive UI and original logo; test Android customer + admin builds and distribution; stage and run real-account end-to-end tests; then promote a verified production release.

Do not turn on customer payments or claim verified signal performance until those checks pass.

## Additional commercial-release requirements

- Vercel Hobby is for personal/non-commercial projects; a paid subscription launch needs a commercial-compatible host or plan. https://vercel.com/docs/plans/hobby
- Google Play generally requires Play Billing for digital subscriptions/features sold inside Play-distributed Android apps; the manual crypto payment flow needs a separate compliant Android approach. https://support.google.com/googleplay/android-developer/answer/9858738
- On Vercel Hobby, scheduled hourly generation is not available through the native Hobby cron cadence; use a suitable scheduler/hosting plan and test actual unattended runs before marketing hourly signals.

Run `node scripts/release-check.cjs` to confirm source and logo readiness; it intentionally exits non-zero while original files remain missing.

## 2026-11-09 — Shared manual billing API implementation

The staging branch now includes reconstructed **api/member.js**, **api/cv-ops.js**, **api/checkout.js**, **lib/billing-service.js**, and **lib/entitlement-store.js**, connected to the 72-hour trial rules and administrator access events. These are newly written substitutes, NOT SHA-1 recovered copies of the original backend.

A sandbox run passed **50/50 isolated regression tests** (excluding the original forex integration test because its engine is still missing). These tests use mocked database storage, sessions, and blockchain responses. **Real Supabase sessions, private Blob storage, network requests, and cross-device end-to-end flows have not passed QA.**

Security rules in code: payment submission stays pending; independent chain verification and server-authenticated administrator action are required for approval; duplicate TXIDs are rejected; proof images are stored privately; approved payments create 30-day entitlement and manual grants use a separate audit record. The on-site wallet is pinned to the previously published BTC-mainnet address, and billing is disabled if it conflicts with a configured wallet. **The account owner must verify that the displayed BTC receiving address is actually under their control before opening payments.**

Production blocker remains: the manifest records 19 unverified original files. Three API source files now have reconstructed implementations, but 16 other original files have not been restored and the original 19 SHA-1 checks cannot be marked complete from replacements. The release gate intentionally remains red. Do not deploy to main.

Next: inspect private Blob store type, test a real verified Supabase customer and admin account against a staging environment, confirm write/read/immutability semantics and image privacy, verify payment cancellation and admin revocation, then resolve missing market/signal/support APIs and complete the original-logo and mobile QA.

## New trial policy (supersedes the previous 24-hour draft)
72 hours from verified phone trial activation, maximum 3 unique premium forex/crypto signal unlocks combined. Trial expires at time limit or immediately after consuming the third unlock. Historical Blob trials must not auto-enable, reset or bypass phone claims. Server migration pending review.
