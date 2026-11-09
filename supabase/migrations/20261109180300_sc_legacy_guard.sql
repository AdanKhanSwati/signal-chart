-- Conservative legacy-account guard.
-- Accounts with trial history created before the rollout require an audited
-- one-time administrator exception. This does NOT grant any repeat trial.
begin;
create table if not exists public.sc_legacy_trial_holds (
 user_id uuid primary key references auth.users(id) on delete restrict,
 source text not null check(source in ('legacy_blob_trial','legacy_manual_review','legacy_import')),
 reason text not null check(length(btrim(reason)) between 5 and 500),
 imported_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id) on delete restrict,
 reviewed_at timestamptz
);
alter table public.sc_legacy_trial_holds enable row level security;
revoke all on table public.sc_legacy_trial_holds from anon,authenticated;
grant select,insert,update,delete on table public.sc_legacy_trial_holds to service_role;

create or replace function public.sc_can_override_legacy_trial(p_user uuid,p_phone_hash text)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.sc_trial_exceptions e
  where e.user_id=p_user and e.phone_hash=p_phone_hash
   and e.redeemed_at is null and e.revoked_at is null and e.valid_until>now())
$$;
revoke all on function public.sc_can_override_legacy_trial(uuid,text) from public,anon,authenticated;
grant execute on function public.sc_can_override_legacy_trial(uuid,text) to service_role;
commit;
