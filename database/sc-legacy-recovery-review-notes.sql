-- Quarantined historical evidence review notes only.
-- A note NEVER grants, revokes, creates, or verifies a payment or trial.
create or replace function public.sc_recovery_add_review_note(
  p_actor uuid,p_item uuid,p_note text
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare selected public.sc_legacy_recovery_items%rowtype;
begin
 if p_actor is null or p_item is null or
    char_length(trim(coalesce(p_note,''))) not between 5 and 1200 then
  raise exception 'Invalid recovery review note' using errcode='22023';
 end if;
 if not exists (
  select 1 from auth.users
  where id=p_actor and email_confirmed_at is not null
 ) then
  raise exception 'Verified operator required' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_actor::text));
 if (select count(*) from public.sc_legacy_recovery_events
     where actor_id=p_actor and recorded_at>now()-interval '1 hour') >= 25 then
   return jsonb_build_object('status','rate_limited');
 end if;
 select * into selected from public.sc_legacy_recovery_items
 where id=p_item for update;
 if selected.id is null then
  return jsonb_build_object('status','not_found');
 end if;
 if selected.review_status='reconciled' then
  return jsonb_build_object('status','review_locked');
 end if;
 insert into public.sc_legacy_recovery_events(
  item_id,actor_id,event_type,details
 ) values (p_item,p_actor,'review_note',trim(p_note));
 update public.sc_legacy_recovery_items
 set review_status='needs_manual_review',updated_at=now()
 where id=p_item and review_status<>'reconciled';
 return jsonb_build_object('status','noted','reviewStatus','needs_manual_review',
   'accessGranted',false,'paymentVerified',false);
end $fn$;

revoke all on function public.sc_recovery_add_review_note(uuid,uuid,text)
 from PUBLIC,anon,authenticated;
grant execute on function public.sc_recovery_add_review_note(uuid,uuid,text)
 to service_role;
comment on function public.sc_recovery_add_review_note(uuid,uuid,text) is
 'Append-only historical evidence review note; never establishes payment, trial, identity or source authenticity.';
