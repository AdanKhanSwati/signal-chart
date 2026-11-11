-- Quarantined, content-addressed historical evidence linkage.
-- This is only an evidence inventory update. NEVER grants paid/admin/trial access.
-- The caller must have authenticated the operator, verified the object bytes
-- from private Storage by SHA-256 and obtained a complete Blob source inventory.
create or replace function public.sc_recovery_link_evidence(
 p_actor uuid,p_source_key text,p_digest text,p_storage_path text,p_size bigint
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare item public.sc_legacy_recovery_items%rowtype;
declare evidence_size bigint;
declare expected_prefix text;
begin
 if p_actor is null or not exists(
  select 1 from auth.users
  where id=p_actor and email_confirmed_at is not null
 ) then raise exception 'Verified evidence operator required' using errcode='22023'; end if;
 if p_source_key is null or char_length(p_source_key) not between 3 and 512 or
    p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or
    p_size is null or p_size<1 or p_size>3145728
 then raise exception 'Invalid historical evidence reference' using errcode='22023';end if;
 expected_prefix:='sha256/'||left(p_digest,2)||'/'||p_digest||'.';
 if p_storage_path is null or p_storage_path not in
   (expected_prefix||'json',expected_prefix||'png',expected_prefix||'jpg')
 then raise exception 'Invalid content-addressed private path' using errcode='22023';end if;

 select * into item from public.sc_legacy_recovery_items
 where source_platform='vercel_blob' and source_key=p_source_key for update;
 if item.id is null then return jsonb_build_object('status','inventory_missing');end if;
 if item.source_size_bytes is null or item.source_size_bytes<>p_size then
   return jsonb_build_object('status','source_size_mismatch');end if;
 if item.review_status='reconciled' then
   return jsonb_build_object('status','review_locked');end if;
 if item.retrieval_status='verified_read' then
   if item.content_sha256=p_digest and item.private_evidence_path=p_storage_path then
    return jsonb_build_object('status','already_recorded','accessGranted',false,
      'paymentVerified',false);
   end if;
   return jsonb_build_object('status','existing_evidence_conflict');
 end if;
 if not exists (select 1 from storage.buckets where id='sc-legacy-evidence' and public=false)
 then return jsonb_build_object('status','private_bucket_unavailable');end if;
 select (metadata->>'size')::bigint into evidence_size
 from storage.objects where bucket_id='sc-legacy-evidence' and name=p_storage_path;
 if not found then return jsonb_build_object('status','private_object_missing');end if;
 if evidence_size is null or evidence_size<>p_size then
   return jsonb_build_object('status','stored_size_mismatch');end if;
 -- CAUTION: Storage metadata does not independently prove bytes or source
 -- authenticity. The readback SHA-256 check is performed by the private Node
 -- uploader before this function is invoked.
 update public.sc_legacy_recovery_items
 set content_sha256=p_digest,private_evidence_path=p_storage_path,
     recovered_at=now(),retrieval_status='verified_read',
     review_status='needs_manual_review',updated_at=now()
 where id=item.id;
 insert into public.sc_legacy_recovery_events(item_id,actor_id,event_type,details)
 values(item.id,p_actor,'evidence_recovered',
 'Content-addressed private copy staged for manual provenance and payment review');
 return jsonb_build_object('status','evidence_staged','accessGranted',false,
   'paymentVerified',false,'sourceAuthenticityVerified',false);
end $fn$;

revoke all on function public.sc_recovery_link_evidence(uuid,text,text,text,bigint)
 from PUBLIC,anon,authenticated;
grant execute on function public.sc_recovery_link_evidence(uuid,text,text,text,bigint)
 to service_role;
comment on function public.sc_recovery_link_evidence(uuid,text,text,text,bigint) is
 'Records independently byte-verified private evidence for manual review; does not establish paid or trial entitlements.';
