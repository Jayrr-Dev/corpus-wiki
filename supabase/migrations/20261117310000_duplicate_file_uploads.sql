-- Normal uploads reuse an existing source by filename as well as exact bytes.
-- Replacements and approved external evidence still use ingest_source directly.
create function public.find_uploaded_file(p_title text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.sources
  where origin = 'internal' and lower(btrim(title)) = lower(btrim(p_title))
  order by (archived_at is null) desc, created_at desc, id
  limit 1
$$;

create function public.ingest_uploaded_file(
  p_title text, p_mime_type text, p_source_date timestamptz,
  p_hash text, p_storage_path text, p_passages jsonb,
  p_byte_size bigint default null, p_page_count integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing uuid;
begin
  -- Serialize the short recording transaction, including renamed identical files.
  perform pg_advisory_xact_lock(hashtext('second-brain:upload-file'));
  select id into existing from public.sources where hash = p_hash;
  if existing is null then existing := public.find_uploaded_file(p_title); end if;
  if existing is not null then
    return jsonb_build_object('skipped', true, 'sourceId', existing);
  end if;
  return public.ingest_source(p_title, p_mime_type, p_source_date, p_hash,
    p_storage_path, p_passages, p_byte_size, p_page_count);
end $$;

revoke execute on function public.find_uploaded_file(text) from public, anon, authenticated;
revoke execute on function public.ingest_uploaded_file(text,text,timestamptz,text,text,jsonb,bigint,integer) from public, anon, authenticated;
grant execute on function public.find_uploaded_file(text) to service_role;
grant execute on function public.ingest_uploaded_file(text,text,timestamptz,text,text,jsonb,bigint,integer) to service_role;
