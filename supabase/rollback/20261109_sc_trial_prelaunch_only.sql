-- SignalChart additive trial rollback, safe ONLY BEFORE first real data.
-- This deliberately refuses to destroy any trial/phone/payment/audit records.
-- Review and back up Supabase before applying. Do not run automatically.
begin;
do $$
begin
 if exists(select 1 from public.sc_phone_trial_claims)
 or exists(select 1 from public.sc_trial_exceptions)
 or exists(select 1 from public.sc_trials)
 or exists(select 1 from public.sc_trial_signal_unlocks)
 or exists(select 1 from public.sc_paid_access)
 or exists(select 1 from public.sc_trial_risk_events)
 or exists(select 1 from public.sc_trial_events)
 or exists(select 1 from public.sc_trial_admin_audit)
 or exists(select 1 from public.sc_premium_signals)
 or exists(select 1 from public.sc_legacy_trial_holds)
 then raise exception 'Rollback blocked: SignalChart data exists. Export and create an audited migration; do not delete production records.';
 end if;
end $$;
drop function if exists public.sc_can_override_legacy_trial(uuid,text);
drop function if exists public.sc_admin_trial_analytics();
drop function if exists public.sc_admin_trial_list(text,integer);
drop function if exists public.sc_admin_trial_action(uuid,text,uuid,text,text,timestamptz);
drop function if exists public.sc_signal_detail_server(text);
drop function if exists public.sc_log_trial_event(uuid,text,text);
drop function if exists public.sc_otp_rate_check(uuid,text,text,text,text);
drop function if exists public.sc_register_paid_access(uuid,text,uuid,timestamptz);
drop function if exists public.sc_paid_signal(uuid,text);
drop function if exists public.sc_signal_public_list(text,integer);
drop function if exists public.sc_unlock_trial(uuid,text);
drop function if exists public.sc_activate_trial(uuid,text,timestamptz);
drop function if exists public.sc_trial_state(uuid);
drop table if exists public.sc_legacy_trial_holds;
drop table if exists public.sc_trial_admin_audit;
drop table if exists public.sc_trial_events;
drop table if exists public.sc_trial_risk_events;
drop table if exists public.sc_paid_access;
drop table if exists public.sc_trial_signal_unlocks;
drop table if exists public.sc_premium_signals;
drop table if exists public.sc_trials;
drop table if exists public.sc_trial_exceptions;
drop table if exists public.sc_phone_trial_claims;
commit;
