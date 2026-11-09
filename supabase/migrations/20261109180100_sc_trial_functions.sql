-- SignalChart trial v1: server-role-only transactional functions.
-- Callable exclusively with a backend-only Supabase service-role credential.
begin;

create or replace function public.sc_trial_state(p_user uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare t public.sc_trials%rowtype;
declare paid_end timestamptz;
declare state text;
begin
 if p_user is null then raise exception 'User ID required' using errcode='22023';end if;
 select * into t from public.sc_trials where user_id=p_user;
 select max(expires_at) into paid_end from public.sc_paid_access
  where user_id=p_user and revoked_at is null and starts_at<=now() and expires_at>now();
 if t.id is null then
  return jsonb_build_object('trialStatus','not_activated','activatedAt',null,'expiresAt',null,
    'signalsUsed',0,'signalsRemaining',0,'paidUntil',paid_end,'trialActive',false,'canUnlock',false);
 end if;
 state:=case
   when t.revoked_at is not null then 'revoked'
   when now()>=t.expires_at then 'expired'
   when t.signals_consumed>=3 then 'exhausted'
   else 'active' end;
 return jsonb_build_object('trialStatus',state,'activatedAt',t.activated_at,
  'expiresAt',t.expires_at,'signalsUsed',t.signals_consumed,
  'signalsRemaining',case when state='active' then 3-t.signals_consumed else 0 end,
  'paidUntil',paid_end,'trialActive',(state='active'),
  'canUnlock',(state='active'));
end $$;

create or replace function public.sc_activate_trial(
 p_user uuid,p_phone_hash text,p_phone_verified_at timestamptz)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare existing public.sc_trials%rowtype;
declare owner_user uuid;
declare v_exception public.sc_trial_exceptions%rowtype;
declare claim_id uuid;
declare start_at timestamptz;
begin
 if p_user is null or p_phone_hash !~ '^[0-9a-f]{64}$'
  or p_phone_verified_at is null or p_phone_verified_at>now()+interval '2 minutes'
   then raise exception 'Invalid verified phone proof' using errcode='22023';end if;
 -- Serializes claim attempts from concurrent new accounts sharing the same phone.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_phone_hash));
 select * into existing from public.sc_trials where user_id=p_user for update;
 if existing.id is not null then
  return jsonb_build_object('result','existing_trial','trial',public.sc_trial_state(p_user));
 end if;
 select first_user_id into owner_user from public.sc_phone_trial_claims where phone_hash=p_phone_hash;
 if owner_user is not null and owner_user<>p_user then
  select * into v_exception from public.sc_trial_exceptions
   where user_id=p_user and phone_hash=p_phone_hash
     and redeemed_at is null and revoked_at is null and valid_until>now()
   order by approved_at desc limit 1 for update;
  if v_exception.id is null then
   insert into public.sc_trial_events(user_id,event_type) values(p_user,'trial_reused_phone');
   return jsonb_build_object('result','already_used',
    'message','This number has already been used for a free trial. You can continue with a paid membership.');
  end if;
 end if;
 -- First phone-claim stays permanently tied to the first claimant. An admin exception
 -- never destroys history or revokes the first account.
 insert into public.sc_phone_trial_claims(phone_hash,first_user_id)
  values(p_phone_hash,p_user) on conflict(phone_hash) do nothing;
 start_at:=now();
 insert into public.sc_trials(user_id,phone_hash,phone_verified_at,activated_at,expires_at,exception_id)
  values(p_user,p_phone_hash,p_phone_verified_at,start_at,start_at+interval '72 hours',v_exception.id)
  returning id into claim_id;
 if v_exception.id is not null then
  update public.sc_trial_exceptions set redeemed_at=now() where id=v_exception.id;
  insert into public.sc_trial_events(user_id,trial_id,event_type)
   values(p_user,claim_id,'trial_exception');
 end if;
 insert into public.sc_trial_events(user_id,trial_id,event_type)
  values(p_user,claim_id,'trial_activated');
 return jsonb_build_object('result','activated','trial',public.sc_trial_state(p_user));
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
  where signal_key=p_signal_key and visible=true;
 if s.signal_key is null then return jsonb_build_object('allowed',false,'reason','not_found');end if;
 -- Row lock serializes simultaneous unlock requests by the SAME user across devices.
 select * into t from public.sc_trials where user_id=p_user for update;
 if t.id is null then return jsonb_build_object('allowed',false,'reason','phone_verification_required');end if;
 if t.revoked_at is not null or now()>=t.expires_at then
  return jsonb_build_object('allowed',false,'reason','trial_expired');
 end if;
 -- Trial is exhausted immediately on the third unique signal. The third request
 -- returns its newly unlocked data; all subsequent requests, including reopens, lock.
 if t.signals_consumed>=3 then
  return jsonb_build_object('allowed',false,'reason','trial_exhausted',
   'signalsUsed',t.signals_consumed,'signalsRemaining',0);
 end if;
 select exists(select 1 from public.sc_trial_signal_unlocks
   where trial_id=t.id and signal_key=p_signal_key) into already;
 if already then
  return jsonb_build_object('allowed',true,'reason','previously_unlocked',
    'signalsUsed',t.signals_consumed,'signalsRemaining',3-t.signals_consumed,
    'data',s.premium_data);
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
  where visible=true and (p_market is null or market=p_market)
  order by published_at desc limit least(greatest(coalesce(p_limit,50),1),100)) z;
 return results;
end $$;

create or replace function public.sc_paid_signal(p_user uuid,p_signal_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare s public.sc_premium_signals%rowtype;
begin
 if not exists(select 1 from public.sc_paid_access
   where user_id=p_user and starts_at<=now() and expires_at>now() and revoked_at is null)
 then return jsonb_build_object('allowed',false,'reason','no_paid_membership');end if;
 select * into s from public.sc_premium_signals where signal_key=p_signal_key and visible=true;
 if s.signal_key is null then return jsonb_build_object('allowed',false,'reason','not_found');end if;
 return jsonb_build_object('allowed',true,'reason','paid','data',s.premium_data);
end $$;

create or replace function public.sc_register_paid_access(
 p_user uuid,p_payment_id text,p_admin uuid,p_verified_at timestamptz)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare existing public.sc_paid_access%rowtype;
declare last_end timestamptz;declare start_at timestamptz;declare new_end timestamptz;
begin
 if p_user is null or p_admin is null or length(coalesce(p_payment_id,'')) not between 8 and 128
  or p_verified_at is null or p_verified_at>now()+interval '2 minutes'
 then raise exception 'Invalid verified payment' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_user::text));
 select * into existing from public.sc_paid_access where payment_id=p_payment_id;
 if existing.id is not null then
  if existing.user_id<>p_user then raise exception 'Payment already assigned' using errcode='23505';end if;
  return jsonb_build_object('result','already_recorded','expiresAt',existing.expires_at);
 end if;
 select max(expires_at) into last_end from public.sc_paid_access
  where user_id=p_user and revoked_at is null and expires_at>now();
 start_at:=greatest(now(),coalesce(last_end,now()));
 new_end:=start_at+interval '30 days';
 insert into public.sc_paid_access(user_id,payment_id,source,verified_by,verified_at,starts_at,expires_at)
  values(p_user,p_payment_id,'verified_crypto_payment',p_admin,p_verified_at,start_at,new_end);
 insert into public.sc_trial_events(user_id,event_type) values(p_user,'payment_approved');
 return jsonb_build_object('result','recorded','expiresAt',new_end);
end $$;

create or replace function public.sc_otp_rate_check(
 p_user uuid,p_phone_hash text,p_network_hash text,p_device_hash text,p_kind text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare sent_1min integer;declare sent_1hr integer;declare failed_15min integer;declare network_5min integer;
declare allowed boolean;declare review boolean;
begin
 if p_user is null or p_phone_hash !~ '^[0-9a-f]{64}$'
  or (p_network_hash is not null and p_network_hash !~ '^[0-9a-f]{64}$')
  or (p_device_hash is not null and p_device_hash !~ '^[0-9a-f]{64}$')
  or p_kind not in ('request','failed','verified','verify_check')
 then raise exception 'Invalid risk event' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_phone_hash));
 select count(*) into sent_1min from public.sc_trial_risk_events
  where phone_hash=p_phone_hash and event_type='otp_request' and created_at>now()-interval '60 seconds';
 select count(*) into sent_1hr from public.sc_trial_risk_events
  where phone_hash=p_phone_hash and event_type='otp_request' and created_at>now()-interval '1 hour';
 select count(*) into failed_15min from public.sc_trial_risk_events
  where phone_hash=p_phone_hash and event_type='otp_verify_failed' and created_at>now()-interval '15 minutes';
 select count(*) into network_5min from public.sc_trial_risk_events
  where network_hash is not null and network_hash=p_network_hash and
  event_type='otp_request' and created_at>now()-interval '5 minutes';
 review:=network_5min>=15;
 allowed:=case when p_kind='request' then sent_1min=0 and sent_1hr<4 and failed_15min<5
   when p_kind='failed' or p_kind='verify_check' then failed_15min<5
   else true end;
 if p_kind<>'verify_check' then
 insert into public.sc_trial_risk_events(user_id,phone_hash,network_hash,device_signal_hash,event_type,risk_level)
  values(p_user,p_phone_hash,p_network_hash,p_device_hash,
   case when p_kind='request' then case when allowed then 'otp_request' else 'otp_request_blocked' end
     when p_kind='failed' then 'otp_verify_failed' else 'otp_verified' end,
   case when allowed then case when review then 'review' else 'normal' end else 'restricted' end);
 end if;
 return jsonb_build_object('allowed',allowed,'reviewSuggested',review,
   'retryAfterSeconds',case when allowed then 0 else 60 end);
end $$;

create or replace function public.sc_log_trial_event(p_user uuid,p_event_type text,p_signal_key text default null)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if p_user is null or p_event_type not in ('upgrade_clicked','payment_submitted','payment_rejected')
 then raise exception 'Invalid event' using errcode='22023';end if;
 insert into public.sc_trial_events(user_id,trial_id,event_type,signal_key)
 values(p_user,(select id from public.sc_trials where user_id=p_user),p_event_type,p_signal_key);
end $$;

-- SECURITY: definer functions are PUBLIC-executable by default unless explicitly revoked.
revoke all on function public.sc_trial_state(uuid) from public,anon,authenticated;
revoke all on function public.sc_activate_trial(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.sc_unlock_trial(uuid,text) from public,anon,authenticated;
revoke all on function public.sc_signal_public_list(text,integer) from public,anon,authenticated;
revoke all on function public.sc_paid_signal(uuid,text) from public,anon,authenticated;
revoke all on function public.sc_register_paid_access(uuid,text,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.sc_otp_rate_check(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.sc_log_trial_event(uuid,text,text) from public,anon,authenticated;
grant execute on function public.sc_trial_state(uuid) to service_role;
grant execute on function public.sc_activate_trial(uuid,text,timestamptz) to service_role;
grant execute on function public.sc_unlock_trial(uuid,text) to service_role;
grant execute on function public.sc_signal_public_list(text,integer) to service_role;
grant execute on function public.sc_paid_signal(uuid,text) to service_role;
grant execute on function public.sc_register_paid_access(uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.sc_otp_rate_check(uuid,text,text,text,text) to service_role;
grant execute on function public.sc_log_trial_event(uuid,text,text) to service_role;
commit;
