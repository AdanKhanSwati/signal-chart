-- SignalChart historical evidence quarantine bucket.
-- No object is uploaded by this migration. Historical payment proof is
-- NOT a verified transaction and this bucket grants NO premium access.
insert into storage.buckets (
  id,name,public,file_size_limit,allowed_mime_types
) values (
  'sc-legacy-evidence','sc-legacy-evidence',false,3145728,
  array['application/json','image/png','image/jpeg']::text[]
)
on conflict (id) do nothing;
-- Do not grant authenticated/anon object policies. The service role alone
-- can recover historical evidence using a private API key kept off-client.
