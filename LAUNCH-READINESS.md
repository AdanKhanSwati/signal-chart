# SignalChart release readiness

Status: **BLOCKED — NOT DEPLOYABLE**. This branch is source recovery and fixes, NOT the production website.

- Original deployment source: 85 of 104 files recovered with SHA-1 verification.
- Missing: 17 original backend/test modules + 2 PNGs; see recovery-manifest.json.
- GitHub project is publicly visible. Make it private before releasing proprietary server code.
- Production API reported Supabase configured, signals enabled, payments disabled, and hourly signal generation on-demand, not unattended (2026-11-09).
- Corrected 24-hour trial entitlement and customer-facing wording here; new isolated tests included. The live environment is NOT updated.
- Git auto-deploy for this recovery branch is disabled using Vercel git.deploymentEnabled to avoid deploying partial code.

Required before launching: complete/replace missing backend securely; verify user/admin roles, password/reset, billing approval/rejection and no-payment lock; validate economic data and hourly jobs; independently backtest signals and risk controls; verify responsive UI and original logo; test Android customer + admin builds and distribution; stage and run real-account end-to-end tests; then promote a verified production release.

Do not turn on customer payments or claim verified signal performance until those checks pass.

## Additional commercial-release requirements

- Vercel Hobby is for personal/non-commercial projects; a paid subscription launch needs a commercial-compatible host or plan. https://vercel.com/docs/plans/hobby
- Google Play generally requires Play Billing for digital subscriptions/features sold inside Play-distributed Android apps; the manual crypto payment flow needs a separate compliant Android approach. https://support.google.com/googleplay/android-developer/answer/9858738
- On Vercel Hobby, scheduled hourly generation is not available through the native Hobby cron cadence; use a suitable scheduler/hosting plan and test actual unattended runs before marketing hourly signals.

Run `node scripts/release-check.cjs` to confirm source and logo readiness; it intentionally exits non-zero while original files remain missing.
