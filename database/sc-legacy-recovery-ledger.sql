-- SignalChart historical Vercel Blob recovery inventory.
-- IMPORTANT: Quarantined metadata only. NO payment/trial/access entitlement is
-- generated, approved, revoked or changed by this migration.
-- Source keys and user hints are sensitive; table is service-role only.
create table if not exists public.sc_legacy_recovery_items (
  id uuid primary key default gen_random_uuid(),
  source_platform text not null default 'vercel_blob'
    check (source_platform = 'vercel_blob'),
  source_key text not null
    check (char_length(source_key) between 3 and 512),
  item_kind text not null default 'unknown'
    check (item_kind in (
      'member','payment','review','grant','audit','signal','unknown'
    )),
  source_size_bytes bigint
    check (source_size_bytes is null or (source_size_bytes>=0 and source_size_bytes<=10485760)),
  source_modified_at timestamptz,
  user_id_hint uuid references auth.users(id) on delete set null,
  content_sha256 text
    check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  private_evidence_path text
    check (private_evidence_path is null or char_length(private_evidence_path) between 3 and 512),
  recovered_at timestamptz,
  retrieval_status text not null default 'inventory_only'
    check (retrieval_status in ('inventory_only','verified_read','not_accessible')),
  review_status text not null default 'pending'
    check (review_status in ('pending','needs_manual_review','reconciled')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note)<=2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sc_legacy_recovery_source_unique unique (source_platform,source_key),
  constraint sc_legacy_recovery_verified_bytes_check check (
    (retrieval_status <> 'verified_read') or
    (content_sha256 is not null and recovered_at is not null)
  ),
  constraint sc_legacy_recovery_reviewed_check check (
    (review_status <> 'reconciled') or
    (retrieval_status = 'verified_read' and
     content_sha256 is not null and
     private_evidence_path is not null and
     reviewed_by is not null and
     reviewed_at is not null)
  )
);
create index if not exists sc_legacy_recovery_item_review_idx
  on public.sc_legacy_recovery_items(review_status,retrieval_status,created_at);
create index if not exists sc_legacy_recovery_item_user_hint_idx
  on public.sc_legacy_recovery_items(user_id_hint)
  where user_id_hint is not null;

alter table public.sc_legacy_recovery_items enable row level security;
revoke all on table public.sc_legacy_recovery_items from PUBLIC, anon, authenticated;
revoke all on table public.sc_legacy_recovery_items from service_role;
grant select,insert,update on table public.sc_legacy_recovery_items to service_role;

comment on table public.sc_legacy_recovery_items is
 'Private historical Blob evidence inventory. Contains NO authoritative trial, member, admin or paid-access grants. Never use it for access checks.';
comment on column public.sc_legacy_recovery_items.user_id_hint is
 'Unverified association hint only. MUST NOT be treated as proof of ownership or payment.';
comment on column public.sc_legacy_recovery_items.review_status is
 'Reconciliation workflow metadata, never proof of an active customer entitlement.';

-- Immutable (append-only) audit entries for curator actions; no automatic
-- historical trust escalation or SQL hooks into protected access tables.
create table if not exists public.sc_legacy_recovery_events (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.sc_legacy_recovery_items(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'inventory_recorded','evidence_recovered','manual_review_required',
    'manually_reconciled','evidence_unavailable','review_note'
  )),
  details text check (details is null or char_length(details)<=1200),
  recorded_at timestamptz not null default now()
);
create index if not exists sc_legacy_recovery_events_item_idx
  on public.sc_legacy_recovery_events(item_id,recorded_at);
alter table public.sc_legacy_recovery_events enable row level security;
revoke all on table public.sc_legacy_recovery_events from PUBLIC, anon, authenticated;
revoke all on table public.sc_legacy_recovery_events from service_role;
grant select,insert on table public.sc_legacy_recovery_events to service_role;
grant usage,select on sequence public.sc_legacy_recovery_events_id_seq to service_role;
comment on table public.sc_legacy_recovery_events is
 'Append-only server-managed recovery audit. Client roles have no access; never grants entitlements.';
