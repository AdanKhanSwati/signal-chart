-- SignalChart autonomous scan scheduler (Supabase pg_cron + pg_net).
-- Initial job state intentionally INACTIVE while the full website release gate is blocked.
-- Change active=true only after deployment, source verification, signed HTTP smoke test,
-- and confirmation that sc_auto_signal_control.enabled is enabled.
-- Vault secrets already provisioned: sc_auto_cron_secret and sc_auto_target_url.
begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $check$
begin
 if not exists(select 1 from vault.secrets where name='sc_auto_cron_secret')
 or not exists(select 1 from vault.secrets where name='sc_auto_target_url')
 then raise exception 'Missing protected hourly scanner credentials in Vault';end if;
end $check$;

select cron.schedule(
 'signalchart-hourly-auto-scan',
 '7 * * * *',
 $job$
  with proof as (
   select floor(extract(epoch from clock_timestamp()))::bigint::text as ts,
    (select decrypted_secret from vault.decrypted_secrets where name='sc_auto_cron_secret') as secret
  )
  select net.http_post(
   url:=(select decrypted_secret from vault.decrypted_secrets where name='sc_auto_target_url'),
   body:='{}'::jsonb,
   headers:=jsonb_build_object(
    'Content-Type','application/json',
    'x-sc-timestamp',proof.ts,
    'x-sc-signature',encode(extensions.hmac(proof.ts||'.{}',proof.secret,'sha256'),'hex')
   ),
   timeout_milliseconds:=75000
  ) as request_id
  from proof;
 $job$
);
select cron.alter_job(
 job_id:=(select jobid from cron.job where jobname='signalchart-hourly-auto-scan'),
 active:=false
);
commit;
