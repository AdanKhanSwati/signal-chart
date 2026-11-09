-- Freshness safety: short-lived published trading signals, no stale unlocks.
-- This is a forward-only additive migration and never resets trial quotas.
begin;
alter table public.sc_premium_signals add column if not exists expires_at timestamptz;
update public.sc_premium_signals set expires_at=published_at+interval '2 hours' where expires_at is null;
alter table public.sc_premium_signals alter column expires_at set default (now()+interval '2 hours');
alter table public.sc_premium_signals alter column expires_at set not null;
alter table public.sc_premium_signals
 add constraint sc_premium_signal_expiry_after_publication check(expires_at>published_at);

create or replace function public.sc_signal_public_list(
 p_market text default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare results jsonb;
begin
 if p_market is not null and p_market not in ('crypto','forex')
 then raise exception 'Invalid market' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'signalKey',z.signal_key,'market',z.market,'asset',z.asset,
   'publishedAt',z.published_at) order by z.published_at desc),
   '[]'::jsonb) into results
 from (select signal_key,market,asset,published_at
  from public.sc_premium_signals
  where visible=true and expires_at>now() and (p_market is null or market=p_market)
  order by published_at desc limit least(greatest(coalesce(p_limit,50),1),100)) z;
 return results;
end $$;

create or replace function public.sc_unlock_trial(p_user uuid,p_signal_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare t public.sc_trials%rowtype;
declare s public.sc_premium_signals%rowtype;
declare already boolean;
declare used integer;
begin
 if p_user is null or p_signal_key is null or length(p_signal_key) not between 3 and 140
 then raise exception 'Invalid unlock request' using errcode='22023'; end if;
 select * into s from public.sc_premium_signals
  where signal_key=p_signal_key and visible=true and expires_at>now();
 if s.signal_key is null then return jsonb_build_object('allowed',false,'reason','not_found');end if;

 -- Lock the user's row, serializing concurrent requests across all devices.
 select * into t from public.sc_trials where user_id=p_user for update;
 if t.id is null then return jsonb_build_object('allowed',false,'reason','phone_verification_required');end if;
 if t.revoked_at is not null or now()>=t.expires_at then
  return jsonb_build_object('allowed',false,'reason','trial_expired');
 end if;

 -- Existing unlocks are readable throughout the active term, including after
 -- all three UNIQUE slots have been consumed. No new allowance is created.
 select exists(select 1 from public.sc_trial_signal_unlocks
   where trial_id=t.id and signal_key=p_signal_key) into already;
 if already then
  return jsonb_build_object('allowed',true,'reason','previously_unlocked',
    'signalsUsed',t.signals_consumed,
    'signalsRemaining',greatest(0,3-t.signals_consumed),
    'data',s.premium_data);
 end if;

 -- A fourth unique crypto/forex signal is always denied.
 if t.signals_consumed>=3 then
  return jsonb_build_object('allowed',false,'reason','trial_exhausted',
   'signalsUsed',t.signals_consumed,'signalsRemaining',0);
 end if;

 insert into public.sc_trial_signal_unlocks(trial_id,user_id,signal_key,market,asset)
  values(t.id,p_user,p_signal_key,s.market,s.asset);
 update public.sc_trials set signals_consumed=signals_consumed+1,updated_at=now()
  where id=t.id returning signals_consumed into used;
 insert into public.sc_trial_events(user_id,trial_id,event_type,signal_key)
  values(p_user,t.id,'signal_unlocked',p_signal_key);
 if used=3 then
  insert into public.sc_trial_events(user_id,trial_id,event_type)
   values(p_user,t.id,'trial_exhausted');
 end if;
 return jsonb_build_object('allowed',true,'reason','newly_unlocked',
   'signalsUsed',used,'signalsRemaining',3-used,
   'trialExhausted',used=3,'data',s.premium_data);
end $$;

create or replace function public.sc_paid_signal(p_user uuid,p_signal_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare s public.sc_premium_signals%rowtype;
begin
 if not exists(select 1 from public.sc_paid_access
   where user_id=p_user and starts_at<=now() and expires_at>now() and revoked_at is null)
 then return jsonb_build_object('allowed',false,'reason','no_paid_membership');end if;
 select * into s from public.sc_premium_signals where signal_key=p_signal_key and visible=true and expires_at>now();
 if s.signal_key is null then return jsonb_build_object('allowed',false,'reason','not_found');end if;
 return jsonb_build_object('allowed',true,'reason','paid','data',s.premium_data);
end $$;

create or replace function public.sc_signal_detail_server(p_signal_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare s public.sc_premium_signals%rowtype;
begin
 select * into s from public.sc_premium_signals
  where signal_key=p_signal_key and visible=true and expires_at>now();
 if s.signal_key is null then
  return jsonb_build_object('found',false);
 end if;
 return jsonb_build_object('found',true,'data',s.premium_data,
   'market',s.market,'asset',s.asset,'signalKey',s.signal_key);
end $$;

create or replace function public.sc_review_premium_signal(
 p_actor uuid,p_proposal uuid,p_decision text,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare proposal public.sc_signal_proposals%rowtype;
begin
 if p_actor is null or not exists(select 1 from auth.users where id=p_actor)
  or p_proposal is null or p_decision not in ('approve','reject')
  or length(trim(coalesce(p_reason,'')))<8
 then raise exception 'Review details required' using errcode='22023';end if;
 select * into proposal from public.sc_signal_proposals where id=p_proposal for update;
 if proposal.id is null then raise exception 'Proposal not found' using errcode='22023';end if;
 if proposal.status<>'pending' then raise exception 'Proposal already reviewed' using errcode='23505';end if;
 if p_decision='approve' and (
   now()-proposal.candle_closed_at>interval '4 hours'
   or proposal.candle_closed_at>now()-interval '1 minute')
 then raise exception 'Market data is stale; publish a fresh review instead'
   using errcode='22023';end if;
 if p_decision='approve' then
   insert into public.sc_premium_signals
      (signal_key,market,asset,public_meta,premium_data,published_at,visible,expires_at)
   values (proposal.signal_key,proposal.market,proposal.asset,
     jsonb_build_object('sourceBasis',proposal.source,'review','manual'),
     proposal.analysis,now(),true,now()+interval '2 hours');
 end if;
 update public.sc_signal_proposals
 set status=case when p_decision='approve' then 'approved' else 'rejected' end,
  reviewed_by=p_actor,reviewed_at=now(),review_note=left(p_reason,1000)
 where id=p_proposal;
 return jsonb_build_object('proposalId',p_proposal,
   'status',case when p_decision='approve' then 'approved' else 'rejected' end,
   'published',p_decision='approve');
end $$;

create table if not exists public.sc_signal_revocations (
 id uuid primary key default gen_random_uuid(),
 signal_key text not null references public.sc_premium_signals(signal_key),
 revoked_by uuid not null references auth.users(id),
 reason text not null check(length(reason) between 8 and 1000),
 revoked_at timestamptz not null default now()
);
alter table public.sc_signal_revocations enable row level security;
revoke all on table public.sc_signal_revocations from public,anon,authenticated;
grant select,insert on table public.sc_signal_revocations to service_role;

create or replace function public.sc_revoke_premium_signal(
 p_actor uuid,p_signal_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare changed integer;
begin
 if p_actor is null or not exists(select 1 from auth.users where id=p_actor)
  or p_signal_key is null or length(trim(coalesce(p_reason,'')))<8
 then raise exception 'Valid administrator, signal and reason required' using errcode='22023';end if;
 update public.sc_premium_signals set visible=false
 where signal_key=p_signal_key and visible=true;
 get diagnostics changed=row_count;
 if changed>0 then
  insert into public.sc_signal_revocations(signal_key,revoked_by,reason)
   values(p_signal_key,p_actor,left(p_reason,1000));
 end if;
 return jsonb_build_object('revoked',changed>0);
end $$;

-- The server is the only caller of privileged publication and reveal routines.
revoke all on function public.sc_signal_public_list(text,integer) from public,anon,authenticated;
revoke all on function public.sc_unlock_trial(uuid,text) from public,anon,authenticated;
revoke all on function public.sc_paid_signal(uuid,text) from public,anon,authenticated;
revoke all on function public.sc_signal_detail_server(text) from public,anon,authenticated;
revoke all on function public.sc_review_premium_signal(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.sc_revoke_premium_signal(uuid,text,text) from public,anon,authenticated;
grant execute on function public.sc_signal_public_list(text,integer) to service_role;
grant execute on function public.sc_unlock_trial(uuid,text) to service_role;
grant execute on function public.sc_paid_signal(uuid,text) to service_role;
grant execute on function public.sc_signal_detail_server(text) to service_role;
grant execute on function public.sc_review_premium_signal(uuid,uuid,text,text) to service_role;
grant execute on function public.sc_revoke_premium_signal(uuid,text,text) to service_role;
commit;
