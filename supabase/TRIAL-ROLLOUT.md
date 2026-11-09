# Supabase migration and launch readiness — SignalChart

## Migration status (2026-11-09)
The four additive SQL migrations are **committed but NOT applied** to your connected Supabase project. The connected Supabase database admin tool/service-role credential is unavailable in this conversation. Do not report the live RLS, table contents, SMS, or trial as configured.

The migrations were applied successfully to disposable PGlite/PostgreSQL-compatible test databases. This validates SQL syntax and simulated rules, not production Supabase Auth and Row Level Security under live traffic.

## Inspect before applying (read-only)
Check actual existing auth schema, user accounts, policies and subscribed members first:
- Table names and indexes in \`public\`, \`auth\`, and \`storage\`
- Any prior trial usage in Vercel Blob under \`cv2/members/\` and older subscription stores
- Verified BTC payment approvals, administrator grants, account IDs
- Existing RLS policies and Supabase Auth phone settings
- Whether private Vercel Blob and admin email are correctly configured

The new \`public.sc_*\` tables do not drop, truncate or overwrite older records.
Do **not** import historical free-trial timestamps as fresh promotional trials.

## Before switching on trial activation
- Configure \`SUPABASE_SERVICE_ROLE_KEY\` **server-side only**, never in client JavaScript.
- Configure a long randomly generated \`SC_TRIAL_HMAC_SECRET\` (at least 32 characters). Securely back up this key; changing it without a planned hash migration can permit repeated claims.
- Set \`SC_TRIAL_ROLLOUT_AT\` to the actual UTC cutover timestamp **after** completing the historical-user migration. Older accounts require admin review/exception even if prior Blob data is incomplete.
- Keep \`SUPABASE_URL\`, \`SUPABASE_PUBLISHABLE_KEY\`, verified JWT authentication and \`CANDRIVA_ADMIN_EMAIL\`.
- Configure Supabase Auth phone provider with an SMS service (Twilio, MessageBird, Vonage, etc.), SMS and per-IP quotas, CAPTCHA, resend and region restrictions. This costs money per message; obtain owner approval before enabling.
- Populate \`sc_legacy_trial_holds\` for known prior trial users, and review phone reassignment exceptions before granting more trial access.
- Populate \`sc_premium_signals\` with server-only premium signal details after validating sources; never use an unverified browser-side object as premium signal source.
- Enable the actual Vercel preview environment with payment collection OFF and without promoting its preview to production.
- Inspect the next available deployment budget; avoid exceeding the self-imposed five assistant deployments per rolling 24 hours.

## Account migration decision
- Existing paid memberships and approved manual payments remain valid through the existing Blob authorization path. Mirror them to \`sc_paid_access\` **idempotently** using admin-only \`sync_approved\` after migration, preserving original dates and preventing double-extension.
- Existing users with known historical trial records are NOT granted another trial automatically.
- Existing users without a confirmed phone can use free platform features and paid membership. They need verified SMS to request any new promotional trial.
- Existing users created before \`SC_TRIAL_ROLLOUT_AT\` are held for review unless a one-time audited admin exception is issued.
- On suspected recycled phone numbers, the admin investigates ownership, logs a reason and issues a time-limited exception for that verified identity. Earlier customers stay unaffected.

## Security model
No direct \`anon\` or \`authenticated\` grants on SignalChart trial tables or functions. Only the server-side service role invokes RLS-protected functions through authenticated API routes.
The signal preview lists only signal key, market, asset and timestamp. Premium direction, entry, target, stop, explanation and other trade fields are returned only from a server-authorized explicit POST.
The third unique trial unlock returns the third signal once, marks the trial exhausted and blocks subsequent premium access. Earlier reopened signals consume no extra credit while the trial is not exhausted.
Shared Wi-Fi and VPN usage are advisory risk signals, not automatic bans. OTP requests are restricted by per-number rate checks, and verification attempts are restricted after repeated failures.

## Android
No complete Android Studio customer or Super Admin source project has been recovered in the current GitHub repository or accessible file searches. The shared REST endpoints can be used by the same verified Supabase account, but Play Integrity token verification and actual Android client integration remain unimplemented/unverified.
Google Play distribution of digital subscription products must follow the applicable Play payments policies; do not enable the manual BTC purchase UI inside a Play-distributed app without policy review.

## Reproducible isolated database tests
In a disposable test clone, run:
\`npm install --no-save @electric-sql/pglite@0.5.15\`
\`node scripts/verify-trial-postgres.mjs\`
This installs a testing dependency locally only. It does not mutate production or commit secrets.

## External blockers
1. Supabase project schema inspection and migration execution require authorized Supabase connection (the Supabase plugin is not installed).
2. SMS provider must be configured, billed and tested with real international numbers before OTP can be claimed operational.
3. Real user/admin JWT, row-security and concurrent Postgres requests need staging end-to-end tests.
4. Android project source and Play Integrity credentials are not available.
5. Signal/news/research and forex engine source recovery remain incomplete; do not promote the staging branch into production.

**Do not claim a 100% secure launch until the external checks have passed.**
