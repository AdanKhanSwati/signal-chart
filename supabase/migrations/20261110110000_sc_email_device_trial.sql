-- SignalChart privacy-first 72h trial: email confirmation + recognized browser.
-- Additive migration; preserves all previously phone-verified trials.
-- NEVER treat browser identity as permanent hardware/device identity.
begin;

alter table public.sc_trials
  alter column phone_hash drop not null,
  alter column phone_verified_at drop not null;
alter table public.sc_trials
  add column if not exists proof_method text not null default 'verified_phone';
alter table public.sc_trials
  drop constraint if exists sc_trial_proof_method_check;
alter table public.sc_trials
  add constraint sc_trial_proof_method_check check (
    (proof_method='verified_phone' and phone_hash is not null and phone_verified_at is not null)
    or (proof_method='verified_email_browser' and phone_hash is null and phone_verified_at is null)
  );

-- Expired IP/network risk data must actually be deleted, not merely marked expired.
create index if not exists sc_trial_risk_expiration_idx
 on public.sc_trial_risk_events(expires_at);

create table if not exists public.sc_browser_trial_claims (
  device_hash text primary key check(device_hash ~ '^[0-9a-f]{64}$'),
  first_user_id uuid not null references auth.users(id) on delete restrict,
  first_claimed_at timestamptz not null default now()
);
create index if not exists sc_browser_claims_user_idx
  on public.sc_browser_trial_claims(first_user_id);
alter table public.sc_browser_trial_claims enable row level security;
revoke all on table public.sc_browser_trial_claims from public,anon,authenticated;
grant select,insert,update,delete on table public.sc_browser_trial_claims to service_role;

-- Server-only trusted RPC. Database is authoritative for one trial per UID and
-- one trial per recognized browser, even under concurrent requests.
-- The network hash is a short-lived *risk signal*, never a permanent identifier.
create or replace function public.sc_activate_browser_trial(
 p_user uuid,p_device_hash text,p_network_hash text default null)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 existing public.sc_trials%rowtype;
 existing_owner uuid;
 new_trial_id uuid;
 risk_count integer;
 user_attempts integer;
 start_at timestamptz;
begin
 if p_user is null or p_device_hash !~ '^[0-9a-f]{64}$'
  or (p_network_hash is not null and p_network_hash !~ '^[0-9a-f]{64}$') then
  raise exception 'Invalid verified-browser trial claim' using errcode='22023';
 end if;
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null)
 then raise exception 'Confirmed email required' using errcode='22023';end if;

 -- Prune a bounded batch of expired risk data on each legitimate activation attempt.
 delete from public.sc_trial_risk_events where id in (
  select id from public.sc_trial_risk_events
  where expires_at<now() order by expires_at limit 250
 );
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_device_hash));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_user::text));
 select * into existing from public.sc_trials where user_id=p_user for update;
 if existing.id is not null then
  return jsonb_build_object('result','existing_trial','trial',public.sc_trial_state(p_user));
 end if;
 if exists(select 1 from public.sc_legacy_trial_holds where user_id=p_user) then
  return jsonb_build_object('result','legacy_review_required',
   'message','Historical trial history requires a manual eligibility review.');
 end if;
 select first_user_id into existing_owner from public.sc_browser_trial_claims
  where device_hash=p_device_hash;
 if existing_owner is not null and existing_owner<>p_user then
  insert into public.sc_trial_risk_events(user_id,network_hash,device_signal_hash,
   event_type,risk_level)
   values(p_user,p_network_hash,p_device_hash,'integrity_flag','review');
  return jsonb_build_object('result','device_already_used',
   'message','This browser has already claimed a trial. Sign in to the original account or request a review.');
 end if;

 select count(*) into user_attempts from public.sc_trial_risk_events
  where user_id=p_user and event_type='trial_attempt'
   and created_at>now()-interval '1 hour';
 if user_attempts>=6 then
  insert into public.sc_trial_risk_events(user_id,network_hash,device_signal_hash,
   event_type,risk_level)
   values(p_user,p_network_hash,p_device_hash,'rate_limited','restricted');
  return jsonb_build_object('result','rate_limited','message','Too many attempts. Try again later.');
 end if;

 -- Shared networks trigger a review hint; they do NOT deny a legitimate user.
 select count(*) into risk_count from public.sc_trial_risk_events
  where network_hash=p_network_hash and p_network_hash is not null
   and event_type='trial_attempt' and created_at>now()-interval '1 hour';
 insert into public.sc_trial_risk_events(user_id,network_hash,device_signal_hash,
  event_type,risk_level,expires_at)
  values(p_user,p_network_hash,p_device_hash,'trial_attempt',
   case when risk_count>=3 then 'review' else 'normal' end,now()+interval '30 days');

 insert into public.sc_browser_trial_claims(device_hash,first_user_id)
 values(p_device_hash,p_user) on conflict (device_hash) do nothing;
 select first_user_id into existing_owner from public.sc_browser_trial_claims
  where device_hash=p_device_hash;
 if existing_owner is distinct from p_user then
  return jsonb_build_object('result','device_already_used');
 end if;

 start_at:=now();
 insert into public.sc_trials(user_id,phone_hash,phone_verified_at,proof_method,
  activated_at,expires_at)
 values(p_user,null,null,'verified_email_browser',start_at,start_at+interval '72 hours')
 returning id into new_trial_id;
 insert into public.sc_trial_events(user_id,trial_id,event_type)
 values(p_user,new_trial_id,'trial_activated');
 return jsonb_build_object('result','activated','trial',public.sc_trial_state(p_user),
  'networkRisk',case when risk_count>=3 then 'review' else 'normal' end);
end $$;

revoke all on function public.sc_activate_browser_trial(uuid,text,text) from public,anon,authenticated;
grant execute on function public.sc_activate_browser_trial(uuid,text,text) to service_role;

comment on table public.sc_browser_trial_claims is
 'Permanent HMAC of signed first-party browser token for trial abuse control; no raw fingerprint, email, phone, IP or cookie.';
comment on function public.sc_activate_browser_trial(uuid,text,text) is
 'Trusted backend only; verified email required, permanent recognized-browser claim, IP risk advisory only.';
commit;
