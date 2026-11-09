-- SignalChart trial v1: additive, review-first migration.
-- Apply ONLY after inspecting existing auth users, subscriptions, payment sources and RLS.
-- No existing tables or trial records are modified.
begin;

create table if not exists public.sc_phone_trial_claims (
  phone_hash text primary key check (phone_hash ~ '^[0-9a-f]{64}$'),
  first_user_id uuid not null references auth.users(id) on delete restrict,
  first_claimed_at timestamptz not null default now()
);
create index if not exists sc_phone_claims_user_idx on public.sc_phone_trial_claims(first_user_id);

create table if not exists public.sc_trial_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  phone_hash text not null check(phone_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check(length(btrim(reason)) between 5 and 500),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  valid_until timestamptz not null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  constraint sc_trial_exception_dates check(valid_until>approved_at)
);
create index if not exists sc_trial_exceptions_lookup_idx on public.sc_trial_exceptions(user_id,phone_hash)
 where redeemed_at is null and revoked_at is null;

create table if not exists public.sc_trials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  phone_hash text not null check(phone_hash ~ '^[0-9a-f]{64}$'),
  phone_verified_at timestamptz not null,
  activated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  signals_consumed integer not null default 0 check(signals_consumed between 0 and 3),
  exception_id uuid unique references public.sc_trial_exceptions(id),
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sc_trial_72h_only check(expires_at=activated_at + interval '72 hours')
);
create index if not exists sc_trials_phone_idx on public.sc_trials(phone_hash);
create index if not exists sc_trials_expiry_idx on public.sc_trials(expires_at);
create index if not exists sc_trials_state_idx on public.sc_trials(user_id,revoked_at,expires_at);

-- Public feed must never include premium fields. No browser may select this table.
create table if not exists public.sc_premium_signals (
  signal_key text primary key check(length(signal_key) between 3 and 140),
  market text not null check(market in ('crypto','forex')),
  asset text not null check(length(asset) between 2 and 36),
  public_meta jsonb not null default '{}'::jsonb,
  premium_data jsonb not null,
  published_at timestamptz not null default now(),
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  constraint sc_signal_json_object check(jsonb_typeof(public_meta)='object' and jsonb_typeof(premium_data)='object')
);
create index if not exists sc_signals_market_published_idx on public.sc_premium_signals(market,published_at desc) where visible=true;

create table if not exists public.sc_trial_signal_unlocks (
  trial_id uuid not null references public.sc_trials(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  signal_key text not null references public.sc_premium_signals(signal_key) on delete restrict,
  market text not null check(market in ('crypto','forex')),
  asset text not null check(length(asset) between 2 and 36),
  unlocked_at timestamptz not null default now(),
  primary key (trial_id,signal_key)
);
create index if not exists sc_unlocks_user_idx on public.sc_trial_signal_unlocks(user_id,unlocked_at);
create index if not exists sc_unlocks_signal_idx on public.sc_trial_signal_unlocks(signal_key);

-- Server-only approved entitlements. Do not infer a payment from a screenshot.
create table if not exists public.sc_paid_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  payment_id text unique,
  source text not null check(source in ('verified_crypto_payment','legacy_verified_payment')),
  verified_by uuid references auth.users(id) on delete restrict,
  verified_at timestamptz not null default now(),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sc_paid_dates check(expires_at>starts_at),
  constraint sc_paid_verified_payment check(payment_id is not null and length(payment_id) between 8 and 128)
);
create index if not exists sc_paid_user_expiry_idx on public.sc_paid_access(user_id,expires_at desc) where revoked_at is null;

create table if not exists public.sc_trial_risk_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  phone_hash text check(phone_hash is null or phone_hash ~ '^[0-9a-f]{64}$'),
  network_hash text check(network_hash is null or network_hash ~ '^[0-9a-f]{64}$'),
  device_signal_hash text check(device_signal_hash is null or device_signal_hash ~ '^[0-9a-f]{64}$'),
  event_type text not null check(event_type in (
    'otp_request','otp_request_blocked','otp_verify_failed','otp_verified',
    'signup','trial_attempt','trial_reused_phone','trial_activated',
    'rate_limited','integrity_flag','risk_review','risk_resolved'
  )),
  risk_level text not null default 'normal' check(risk_level in ('normal','review','restricted')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '90 days')
);
create index if not exists sc_risk_phone_time_idx on public.sc_trial_risk_events(phone_hash,created_at desc);
create index if not exists sc_risk_network_time_idx on public.sc_trial_risk_events(network_hash,created_at desc);
create index if not exists sc_risk_user_time_idx on public.sc_trial_risk_events(user_id,created_at desc);

create table if not exists public.sc_trial_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  trial_id uuid references public.sc_trials(id),
  event_type text not null check(event_type in (
    'phone_verified','trial_activated','trial_reused_phone','trial_exhausted',
    'trial_expired','trial_revoked','trial_exception','signal_unlocked',
    'upgrade_clicked','payment_submitted','payment_approved','payment_rejected'
  )),
  signal_key text,
  created_at timestamptz not null default now()
);
create index if not exists sc_trial_events_user_idx on public.sc_trial_events(user_id,created_at desc);
create index if not exists sc_trial_events_type_idx on public.sc_trial_events(event_type,created_at desc);

create table if not exists public.sc_trial_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  subject_id uuid references auth.users(id) on delete restrict,
  action text not null check(action in ('trial_revoke','trial_exception_approve','trial_exception_revoke','trial_risk_review','paid_access_revoke')),
  reason text not null check(length(btrim(reason)) between 5 and 500),
  created_at timestamptz not null default now()
);
create index if not exists sc_admin_audit_subject_idx on public.sc_trial_admin_audit(subject_id,created_at desc);

-- Explicit deny-by-default. Clients use trusted server API routes, not direct SQL tables.
alter table public.sc_phone_trial_claims enable row level security;
alter table public.sc_trial_exceptions enable row level security;
alter table public.sc_trials enable row level security;
alter table public.sc_premium_signals enable row level security;
alter table public.sc_trial_signal_unlocks enable row level security;
alter table public.sc_paid_access enable row level security;
alter table public.sc_trial_risk_events enable row level security;
alter table public.sc_trial_events enable row level security;
alter table public.sc_trial_admin_audit enable row level security;

revoke all on table
  public.sc_phone_trial_claims,public.sc_trial_exceptions,public.sc_trials,
  public.sc_premium_signals,public.sc_trial_signal_unlocks,
  public.sc_paid_access,public.sc_trial_risk_events,public.sc_trial_events,
  public.sc_trial_admin_audit from anon,authenticated;
-- Explicit service-role privileges used ONLY via server-only trusted credentials.
grant select,insert,update,delete on table
  public.sc_phone_trial_claims,public.sc_trial_exceptions,public.sc_trials,
  public.sc_premium_signals,public.sc_trial_signal_unlocks,
  public.sc_paid_access,public.sc_trial_risk_events,public.sc_trial_events,
  public.sc_trial_admin_audit to service_role;
grant usage,select on all sequences in schema public to service_role;

commit;
