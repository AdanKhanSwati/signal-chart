-- SignalChart v1: privileged admin recovery, reporting and premium-data read.
-- All functions remain executable ONLY by service_role through authenticated server.
begin;

create or replace function public.sc_signal_detail_server(p_signal_key text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare s public.sc_premium_signals%rowtype;
begin
 select * into s from public.sc_premium_signals
  where signal_key=p_signal_key and visible=true;
 if s.signal_key is null then
  return jsonb_build_object('found',false);
 end if;
 return jsonb_build_object('found',true,'data',s.premium_data,
   'market',s.market,'asset',s.asset,'signalKey',s.signal_key);
end $$;

create or replace function public.sc_admin_trial_action(
 p_actor uuid,p_action text,p_user uuid,p_phone_hash text,p_reason text,
 p_valid_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare t public.sc_trials%rowtype;
declare exception_id uuid;
declare affected integer;
begin
 if p_actor is null or p_user is null or length(btrim(coalesce(p_reason,''))) not between 5 and 500
 then raise exception 'Invalid administrative action' using errcode='22023';end if;
 if p_action='revoke' then
  update public.sc_trials set revoked_at=now(),revoked_reason=p_reason,updated_at=now()
    where user_id=p_user and revoked_at is null returning * into t;
  get diagnostics affected = row_count;
  if affected=0 then return jsonb_build_object('result','not_active');end if;
  insert into public.sc_trial_admin_audit(actor_id,subject_id,action,reason)
    values(p_actor,p_user,'trial_revoke',p_reason);
  insert into public.sc_trial_events(user_id,trial_id,event_type)
    values(p_user,t.id,'trial_revoked');
  return jsonb_build_object('result','revoked');
 elsif p_action='exception' then
  if p_phone_hash !~ '^[0-9a-f]{64}$'
    or p_valid_until is null or p_valid_until<=now()
    or p_valid_until>now()+interval '30 days'
  then raise exception 'Invalid phone exception' using errcode='22023';end if;
  if exists(select 1 from public.sc_trials where user_id=p_user)
  then raise exception 'Existing trial cannot be reset' using errcode='23505';end if;
  insert into public.sc_trial_exceptions(user_id,phone_hash,reason,approved_by,valid_until)
    values(p_user,p_phone_hash,p_reason,p_actor,p_valid_until)
    returning id into exception_id;
  insert into public.sc_trial_admin_audit(actor_id,subject_id,action,reason)
    values(p_actor,p_user,'trial_exception_approve',p_reason);
  return jsonb_build_object('result','exception_created','exceptionId',exception_id);
 elsif p_action='risk_resolved' then
  insert into public.sc_trial_admin_audit(actor_id,subject_id,action,reason)
    values(p_actor,p_user,'trial_risk_review',p_reason);
  insert into public.sc_trial_risk_events(user_id,event_type,risk_level)
    values(p_user,'risk_resolved','normal');
  return jsonb_build_object('result','review_recorded');
 else
  raise exception 'Unsupported administrative action' using errcode='22023';
 end if;
end $$;

create or replace function public.sc_admin_trial_list(
 p_query text default null,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(q) order by q.activated_at desc),'[]'::jsonb)
 into result from (
  select t.user_id,t.activated_at,t.expires_at,t.signals_consumed,
   case when t.revoked_at is not null then 'revoked'
        when now()>=t.expires_at then 'expired'
        when t.signals_consumed>=3 then 'exhausted'
        else 'active' end as trial_status,
   (select max(p.expires_at) from public.sc_paid_access p
     where p.user_id=t.user_id and p.revoked_at is null and p.expires_at>now()) as paid_until,
   exists(select 1 from public.sc_trial_risk_events e
      where e.user_id=t.user_id and e.risk_level in ('review','restricted')
        and e.created_at>now()-interval '30 days') as risk_flag
  from public.sc_trials t
  where p_query is null or t.user_id::text ilike '%'||left(p_query,100)||'%'
  order by t.activated_at desc limit least(greatest(coalesce(p_limit,100),1),200)
 ) q;
 return result;
end $$;

create or replace function public.sc_admin_trial_analytics()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare total integer;declare active integer;declare expired integer;
declare exhausted integer;declare revoked integer;declare paid integer;
declare first_unlock_avg double precision;declare average_used double precision;
declare exhausted_pct numeric;declare conversion_pct numeric;
declare verified_users integer;declare otp_users integer;declare risk_reviews integer;
begin
 select count(*),
   count(*) filter(where revoked_at is null and expires_at>now() and signals_consumed<3),
   count(*) filter(where revoked_at is null and expires_at<=now()),
   count(*) filter(where signals_consumed>=3),
   count(*) filter(where revoked_at is not null),
   avg(signals_consumed)::double precision
  into total,active,expired,exhausted,revoked,average_used from public.sc_trials;
 select count(distinct t.user_id) into paid from public.sc_trials t
  where exists(select 1 from public.sc_paid_access p where p.user_id=t.user_id);
 select avg(extract(epoch from (f.first_unlock - t.activated_at)))::double precision
  into first_unlock_avg from public.sc_trials t
  join (select trial_id,min(unlocked_at) first_unlock
   from public.sc_trial_signal_unlocks group by trial_id) f on f.trial_id=t.id;
 select count(distinct user_id) into verified_users from public.sc_trial_risk_events
  where event_type='otp_verified';
 select count(distinct user_id) into otp_users from public.sc_trial_risk_events
  where event_type='otp_request';
 select count(distinct user_id) into risk_reviews from public.sc_trial_risk_events
  where risk_level in ('review','restricted') and created_at>now()-interval '30 days';
 exhausted_pct:=case when total>0 then round(100*exhausted::numeric/total,2) else null end;
 conversion_pct:=case when total>0 then round(100*paid::numeric/total,2) else null end;
 return jsonb_build_object(
  'trialActivations',total,'activeTrials',active,'expiredTrials',expired,
  'exhaustedTrials',exhausted,'revokedTrials',revoked,'paidConversions',paid,
  'trialToPaidConversionPercent',conversion_pct,
  'averageSignalsPerTrial',average_used,
  'exhaustionPercent',exhausted_pct,
  'averageSecondsToFirstUnlock',first_unlock_avg,
  'otpRequestedUsers',otp_users,'otpVerifiedUsers',verified_users,
  'verificationCompletionPercent',case when otp_users>0
     then round(100*verified_users::numeric/otp_users,2) else null end,
  'riskReviewUsersLast30Days',risk_reviews);
end $$;

revoke all on function public.sc_signal_detail_server(text) from public,anon,authenticated;
revoke all on function public.sc_admin_trial_action(uuid,text,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.sc_admin_trial_list(text,integer) from public,anon,authenticated;
revoke all on function public.sc_admin_trial_analytics() from public,anon,authenticated;
grant execute on function public.sc_signal_detail_server(text) to service_role;
grant execute on function public.sc_admin_trial_action(uuid,text,uuid,text,text,timestamptz) to service_role;
grant execute on function public.sc_admin_trial_list(text,integer) to service_role;
grant execute on function public.sc_admin_trial_analytics() to service_role;
commit;
