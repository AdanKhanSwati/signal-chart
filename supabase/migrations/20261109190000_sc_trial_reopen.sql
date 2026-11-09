-- SignalChart: trial customers may reopen previously unlocked premium signals
-- for the duration of the active 72-hour trial, without consuming another slot.
-- Trial expiration and revocation still deny all premium access.
-- This is a forward-only compatibility migration; do not modify prior applied history.
begin;

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
  where signal_key=p_signal_key and visible=true;
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

-- SECURITY DEFINER is reserved strictly for trusted server-side callers.
revoke all on function public.sc_unlock_trial(uuid,text) from public,anon,authenticated;
grant execute on function public.sc_unlock_trial(uuid,text) to service_role;
commit;
