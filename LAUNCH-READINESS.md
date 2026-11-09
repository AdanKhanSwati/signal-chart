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
