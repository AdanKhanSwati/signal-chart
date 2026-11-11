-- Follow-on grant tightening after initial ledger creation on existing Supabase.
-- Existing defaults can include service_role DELETE unless explicitly revoked.
revoke all on table public.sc_legacy_recovery_items from service_role;
grant select,insert,update on table public.sc_legacy_recovery_items to service_role;
revoke all on table public.sc_legacy_recovery_events from service_role;
grant select,insert on table public.sc_legacy_recovery_events to service_role;
