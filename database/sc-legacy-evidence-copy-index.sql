-- Private, append-only quarantine index for locally copied legacy evidence.
-- These rows NEVER prove Vercel source authenticity, payment, customer ownership,
-- trial eligibility or premium entitlement. No triggers connect to access tables.
create table if not exists public.sc_legacy_evidence_copies (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.sc_legacy_recovery_items(id) on delete restrict,
  storage_object_name text not null
    check (storage_object_name ~ '^sha256/[a-f0-9]{2}/[a-f0-9]{64}\.(json|png|jpg)$'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size between 1 and 3145728),
  mime_type text not null check (mime_type in ('application/json','image/png','image/jpeg')),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  source_authenticity_verified boolean not null default false
    check (source_authenticity_verified = false),
  payment_verified boolean not null default false check (payment_verified = false),
  access_granted boolean not null default false check (access_granted = false),
  unique (item_id,content_sha256)
);
create index if not exists sc_legacy_evidence_copies_item_idx
 on public.sc_legacy_evidence_copies(item_id,recorded_at);
alter table public.sc_legacy_evidence_copies enable row level security;
revoke all on public.sc_legacy_evidence_copies from PUBLIC,anon,authenticated,service_role;
grant select on public.sc_legacy_evidence_copies to service_role;
comment on table public.sc_legacy_evidence_copies is
 'Append-only quarantined local evidence copies; SHA matching proves bytes only, never historical provenance or paid access.';

-- Only this server-role RPC may link a pre-uploaded object to an existing
-- historical inventory item. No ledger item is created or marked reconciled.
create or replace function public.sc_recovery_record_local_copy(
  p_actor uuid,
  p_source_key text,
  p_sha256 text,
  p_object_name text,
  p_byte_size bigint,
  p_mime_type text
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_item_id uuid;
  v_storage_size text;
  v_storage_mime text;
  v_extension text;
  v_id uuid;
begin
 if p_actor is null or p_source_key is null or
    p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or
    p_byte_size is null or p_byte_size not between 1 and 3145728 or
    p_mime_type not in ('application/json','image/png','image/jpeg') then
  raise exception 'Invalid local evidence metadata' using errcode='22023';
 end if;
 v_extension:=case p_mime_type
   when 'application/json' then 'json'
   when 'image/png' then 'png'
   when 'image/jpeg' then 'jpg' end;
 if p_object_name is distinct from
    'sha256/'||left(p_sha256,2)||'/'||p_sha256||'.'||v_extension then
  raise exception 'Evidence object is not content addressed' using errcode='22023';
 end if;
 if not exists (
   select 1 from auth.users where id=p_actor and email_confirmed_at is not null
 ) then
  raise exception 'Verified operator required' using errcode='22023';
 end if;
 select id into v_item_id from public.sc_legacy_recovery_items
 where source_platform='vercel_blob' and source_key=p_source_key
 and source_size_bytes=p_byte_size;
 if v_item_id is null then
  return jsonb_build_object('status','source_not_in_inventory');
 end if;
 select metadata->>'size',metadata->>'mimetype'
   into v_storage_size,v_storage_mime
 from storage.objects
 where bucket_id='sc-legacy-evidence' and name=p_object_name;
 if v_storage_size is null or v_storage_size !~ '^[0-9]+$' or
    v_storage_size::bigint<>p_byte_size or
    (v_storage_mime is not null and v_storage_mime<>p_mime_type) then
  return jsonb_build_object('status','private_object_not_verified');
 end if;
 insert into public.sc_legacy_evidence_copies (
  item_id,storage_object_name,content_sha256,byte_size,mime_type,recorded_by
 ) values (
  v_item_id,p_object_name,p_sha256,p_byte_size,p_mime_type,p_actor
 ) on conflict (item_id,content_sha256) do nothing
 returning id into v_id;
 if v_id is not null then
  insert into public.sc_legacy_recovery_events(
   item_id,actor_id,event_type,details
  ) values (
   v_item_id,p_actor,'evidence_recovered',
   'Private local copy indexed; SHA checked by uploader; original Vercel provenance not verified.'
  );
 end if;
 return jsonb_build_object(
  'status',case when v_id is null then 'already_indexed' else 'indexed' end,
  'sourceAuthenticityVerified',false,
  'paymentVerified',false,
  'accessGranted',false,
  'inventoryStatusChanged',false
 );
end $fn$;
revoke all on function public.sc_recovery_record_local_copy(uuid,text,text,text,bigint,text)
 from PUBLIC,anon,authenticated;
grant execute on function public.sc_recovery_record_local_copy(uuid,text,text,text,bigint,text)
 to service_role;
comment on function public.sc_recovery_record_local_copy(uuid,text,text,text,bigint,text) is
 'Index locally hashed, private copies against existing historical inventory only; no access, trial or payment authority.';
