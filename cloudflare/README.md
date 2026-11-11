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

## Quarantined historical Blob recovery (November 11)

Private evidence inventory tables now exist in Supabase:

- public.sc_legacy_recovery_items — source object metadata, hash status and independent human-review state.
- public.sc_legacy_recovery_events — append-only recovery audit, not payment approval.
- Applied SQL migrations: sc_legacy_recovery_ledger and sc_legacy_recovery_tighten_grants.
- Both have RLS on. Anonymous and authenticated browser roles cannot read them. The service role can read/insert, but cannot DELETE/TRUNCATE; it cannot UPDATE audit events.
- Neither table authorizes paid access, admin accounts or new trials.

A verified SC_SUPER_ADMIN_UID may GET /api/recovery?action=status for aggregate counts ONLY. No source names, user IDs or evidence bodies cross that HTTP response. Zero imported rows yield inventory_not_imported, NOT proof that no historical data exists. All imported items reviewed is NOT proof that the old Blob listing was complete.

### Source inventory, after legitimate old-store access is restored

Collect the COMPLETE paginated @vercel/blob list output read-only and privately. Save a JSON file outside Git with this format (an illustrative, synthetic object, NOT actual SignalChart data):

    {
      "source": "vercel_blob_list",
      "complete": true,
      "blobs": [
        {"pathname":"audit/example-object.json","size":300,
         "uploadedAt":"2026-11-10T00:00:00Z"}
      ]
    }

Only set complete=true after validating every page, including the last cursor. This is an operator claim; the tool itself cannot independently prove completeness.

Validate without credentials or database mutation:

    node scripts/stage-blob-inventory.cjs --manifest /private/blob-inventory.json --dry-run

After evidence review and with server-only Supabase credentials configured, stage inventory metadata idempotently:

    SC_RECOVERY_IMPORT_APPROVED=true node scripts/stage-blob-inventory.cjs --manifest /private/blob-inventory.json --write

This importer inserts only inventory_only/pending records, with conflict-ignore semantics. It never reads Blob contents, approves payments, grants access, issues trials or marks evidence reconciled. It prints category totals, not personal identifiers, source paths or secrets. Keep JSON manifests and secret keys outside Git.

Still BLOCKED: A verified complete source inventory and readable historical Blob contents have NOT been recovered. Metadata is insufficient to restore historical paid entitlements or receipts.


### Recovery evidence storage

Supabase migration sc_legacy_evidence_bucket created the private bucket sc-legacy-evidence on the Free project. It is public=false, accepts application/json, image/png and image/jpeg, and limits each file to 3 MiB. Live verification found ZERO files and ZERO Storage object policies. No customer can download or upload evidence via the public frontend; server credentials must never be embedded in JavaScript.

The bucket is a destination ONLY. Historical Blob bodies and receipts have NOT yet been recovered, hashed, uploaded or reconciled. Quarantined inventory rows never activate subscriptions or reset trials.


### Offline preflight for recovered Blob bytes (November 11)

After legitimate READ-ONLY access to the suspended original Blob store is restored, download copies to a private local directory **outside Git**. Use the COMPLETE paginated source inventory from the prior section. A second private JSON manifest references the recovered local files, for example:

    {
      "source": "vercel_blob_recovery",
      "objects": [
        {"pathname": "audit/example-object.json",
         "file": "example-object.json",
         "sha256": "64 lowercase hexadecimal characters, if independently recorded"}
      ]
    }

The optional sha256 must be an actual 64-character digest; omit the field if there is no independently recorded digest. The pathname must exactly match the verified source inventory, and file is a relative path beneath the private evidence directory. Only JSON/PNG/JPEG objects up to 3 MiB can pass this preflight; do not delete other original Blob types because the current quarantine bucket cannot accept them.

    node scripts/verify-blob-evidence.cjs \
      --inventory /private/blob-inventory.json \
      --evidence /private/recovered-evidence.json \
      --evidence-dir /private/recovered-files \
      --dry-run

Optionally write a **private local-only** JSON report with computed SHA-256 hashes and source object paths (never commit or paste the report into public logs):

    node scripts/verify-blob-evidence.cjs \
      --inventory /private/blob-inventory.json \
      --evidence /private/recovered-evidence.json \
      --evidence-dir /private/recovered-files \
      --dry-run --write-private-report --output /private/verified-preflight.json

The output file must be new and outside the current Git working directory; it is created with restrictive 0600 permissions. The CLI prints aggregate counts only and suppresses private identifiers in errors. It refuses incomplete source inventories, unexpected/duplicate keys, symlink/traversal paths, mismatched byte lengths, invalid file formats, and wrong digests. The optional digest is only as trustworthy as its independent source.

**Important:** This is a local integrity preflight, NOT proof that files came from the suspended Blob store, that any payment cleared, or that a user owns an entitlement. It makes NO Supabase/Storage writes, does NOT mark evidence as verified_read/reconciled, and never grants access. Actual provenance verification, private evidence upload, audited human review and legacy payment/trial reconciliation remain separate blocked steps.


### Separate append-only evidence copy index (November 11)

A conservative alternative to modifying an inventory row is now available:
`database/sc-legacy-evidence-copy-index.sql` was applied to Supabase as
`sc_legacy_evidence_copy_index`. The private table
`sc_legacy_evidence_copies` stores **local copy metadata only**. It has RLS,
no client policies, and no service-role DELETE permission. The
`sc_recovery_record_local_copy` RPC is callable by service_role only and
requires an existing source-inventory row, a confirmed operator, a private
content-addressed object with matching storage size and MIME, and an exact
SHA-256-shaped object name. It appends an audit event for new links, but **does
not update the source inventory's retrieval/review status**, authenticate
historical provenance, verify any transaction, or grant access.

Use the private offline preflight and upload procedures above first. After
the full source inventory has been independently recovered, the source bytes
have been copied privately and the private object hashes verified, the
following optional command can index the copies:

    node scripts/index-blob-evidence.cjs \
      --inventory /private/blob-inventory.json \
      --evidence /private/recovered-evidence.json \
      --evidence-dir /private/recovered-files --dry-run

    SC_EVIDENCE_INDEX_APPROVED=true \
    SC_RECOVERY_OPERATOR_UID=<verified-auth-user-uuid> \
    node scripts/index-blob-evidence.cjs \
      --inventory /private/blob-inventory.json \
      --evidence /private/recovered-evidence.json \
      --evidence-dir /private/recovered-files --write

For the write, server-only `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
must also be available **only in the private operator environment**. The
indexer reads the stored bytes back and hashes them again before calling the
RPC. It prints only aggregate results. If a source inventory row or private
object is missing, it stops rather than inventing a record.

The separate `scripts/upload-blob-evidence.cjs --write --link-ledger`
path (if used) changes inventory retrieval status to `verified_read` and
requires `SC_RECOVERY_LINK_APPROVED=true` and a configured
`SC_SUPER_ADMIN_UID`. For the most conservative provenance workflow, prefer
the standalone append-only indexer above and leave inventory/review status
unchanged until an authorized manual reconciliation. Neither path authorizes
payments or premium/trial access.

As of November 11, no historical source inventory, private evidence objects,
or linked copy rows have been recovered. **Do not set any write-approval flag
until the full private source inventory and actual files are available.**


### Verified byte transfer into the private Supabase bucket

The upload step is separated from source authenticity and payment approval.
The source Vercel Blob account remains suspended: **no real evidence was
downloaded, transferred or reviewed**.

Validate and hash local files without any network writes:

    node scripts/upload-blob-evidence.cjs \
      --inventory /private/blob-inventory.json \
      --evidence /private/recovered-evidence.json \
      --evidence-dir /private/recovered-files --dry-run

Only after recovering a complete read-only inventory, verifying legitimate
source access and staging the local files outside Git, run on an operator-controlled
server/terminal with its SUPABASE_URL and SUPABASE_SECRET_KEY securely set:

    SC_EVIDENCE_UPLOAD_APPROVED=true \
    node scripts/upload-blob-evidence.cjs \
      --inventory /private/blob-inventory.json \
      --evidence /private/recovered-evidence.json \
      --evidence-dir /private/recovered-files --write

The upload uses a content-addressed SHA-256 object name, no overwrite, and a
second private download plus digest verification. It does not write any
entitlement records or mark Blob provenance established.

For follow-on indexing, use the **preferred separate append-only**
scripts/index-blob-evidence.cjs procedure documented above. It requires
SC_EVIDENCE_INDEX_APPROVED=true and a verified SC_RECOVERY_OPERATOR_UID and
does NOT change inventory retrieval/review status. The alternate
upload-blob-evidence.cjs --link-ledger mode can change the inventory to
verified_read; avoid that mode unless historical provenance and the
original source inventory have been independently checked.

### Private recovery review notes

With the actual Cloudflare administrator UUID configured as SC_SUPER_ADMIN_UID,
a verified administrator can POST /api/recovery?action=note with bounded JSON:

    {"itemId":"<existing recovery item UUID>","note":"Manual review required: ... "}

The server checks the administrator against the verified Supabase Auth UID,
then calls the service-role-only sc_recovery_add_review_note RPC. It appends
a private audit event and changes only the review workflow state. The note
never verifies a transaction, clears a past trial hold or grants premium access.
Never include credentials or customer evidence bodies in an HTTP review note.

**Production blocker:** The old store candriva-private-accounts continues to
report limits-exceeded-suspended with five private objects. No external Blob
source bytes, complete inventory, payment evidence or user ownership records
were recovered in this chat. Cloudflare staging credentials and browser QA
remain outstanding; leave signalchart.pro DNS and payments unchanged.


### Separate HTTP process health vs. launch readiness

- GET /api/health returns HTTP 200 when the Worker process is alive, but explicitly reports productionReady=false.
- GET /api/ready returns HTTP 503, status=migration_incomplete, productionReady=false, and named blockers until an independently verified production release is approved. Its checks cover static-asset binding, public/private Supabase key configuration, trial and premium feature flags, historical recovery, admin billing, live provider QA and browser E2E. It never exposes private keys or personal data.
- Do NOT use a successful health endpoint or green GitHub Actions result as permission to switch signalchart.pro to Cloudflare. The customer and super-admin journeys must pass real staging tests, including historical payment reconciliation.

This is a deliberate release safety guard, not a broken site. The Worker can still serve explicitly implemented public and staging endpoints while readiness returns 503.
