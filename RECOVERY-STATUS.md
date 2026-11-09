# SignalChart — source recovery staging

> **Current verification snapshot — November 10, 2026**  
> **SOURCE RELEASE GATE: BLOCKED.** All 104 paths exist in the staging working tree, but only **93/104 originals have been SHA-1 verified**. The other 11 are independently reconstructed files, NOT recovered original bytes. The original deployment source interface provides incomplete/truncated file contents. Do not treat these copies as byte-identical.  
> The latest isolated test suite passed **125/125** checks, including PGlite PostgreSQL trial/auto-publishing integration and new 72-hour exhausted-trial navigation coverage. These are not live user end-to-end tests.  
> The autonomous signal scanner, secured publishing RPC and hourly Supabase Cron job exist, but **Cron is inactive**, **the database publication switch is off**, and Vercel production remains unchanged.  
> Remaining work: validate reconstructed backend against live-compatible private Blob storage, Supabase sessions, payment-chain verification, market providers and deployed staging; complete customer/admin Android builds and payment compliance.  
> **Current operational next step:** source-equivalence/compatibility QA and a consolidated isolated staging smoke release. This snapshot supersedes historical counts below.


**Status: partial source recovery only — NOT READY TO DEPLOY.**

- Original Vercel deployment: `dpl_7V8tjUnDnMNAmW1xAwBZUYvMRfzD`
- Total source files: **104**
- Recovered and verified byte-for-byte (SHA-1): **85**
- Still missing: **19** (17 backend/test source files and 2 PNG images)
- Source branch: `signalchart-recovery-staging`
- Production: untouched; do **not** merge this branch into `main` until complete and tested.

The 80 top-level non-binary sources, including pages, CSS, JS, SVG, JSON and manifests, are recovered. Five small server/test files are recovered. See `recovery-manifest.json` for the exact original content hashes and missing filenames.

Important: This is a snapshot of existing files, not the approved original-logo replacement. No colour or visual changes have been applied.

The repository is currently public; before uploading sensitive backend code or maintaining an anonymous brand, consider making it private in GitHub settings.
