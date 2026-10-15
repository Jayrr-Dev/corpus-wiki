-- =====================================================================
-- SECOND BRAIN · SOURCE FILE FACTS
-- =====================================================================
-- A source records how big its file is and how many pages it has, so the
-- source screen can describe the file, not just name it.
--   byte_size   the stored file's size in bytes
--   page_count  pages in the file (null for formats without pages)
-- Existing sources are backfilled from the storage bucket and from the
-- page numbers their passages carry.
-- =====================================================================

alter table public.sources
  add column byte_size bigint,
  add column page_count integer;
comment on column public.sources.byte_size is 'Size of the stored file in bytes.';
comment on column public.sources.page_count is 'Pages in the file; null for formats without pages (Word, text, Markdown).';

-- BACKFILL: size from the stored object, pages from the highest passage page
update public.sources s
set byte_size = (o.metadata ->> 'size')::bigint
from storage.objects o
where o.bucket_id = 'sources' and o.name = s.storage_path and s.byte_size is null;

update public.sources s
set page_count = pages.max_page
from (
  select source_id, max((location ->> 'page')::integer) as max_page
  from public.passages
  where location ? 'page'
  group by source_id
) pages
where pages.source_id = s.id and s.page_count is null;


-- =====================================================================
-- INGEST: ingest_source takes the file's size and page count
-- =====================================================================

drop function public.ingest_source(text, text, timestamptz, text, text, jsonb);

create function public.ingest_source(
  p_title text,
  p_mime_type text,
  p_source_date timestamptz,
  p_hash text,
  p_storage_path text,
  p_passages jsonb,
  p_byte_size bigint default null,
  p_page_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_id uuid;
  v_event_id uuid;
begin
  select id into v_source_id from public.sources where hash = p_hash;
  if v_source_id is not null then
    return jsonb_build_object('skipped', true, 'sourceId', v_source_id);
  end if;
  insert into public.sources (title, mime_type, source_date, hash, storage_path, byte_size, page_count)
  values (p_title, p_mime_type, p_source_date, p_hash, p_storage_path, p_byte_size, p_page_count)
  returning id into v_source_id;
  insert into public.passages (source_id, position, location, text, hash, speaker_label)
  select v_source_id, (p ->> 'position')::integer, coalesce(p -> 'location', '{}'), p ->> 'text',
         p ->> 'hash', p ->> 'speakerLabel'
  from jsonb_array_elements(coalesce(p_passages, '[]')) p;
  insert into public.shift_events (cause, source_id, actor, status)
  values ('upload', v_source_id, 'ai', 'received')
  returning id into v_event_id;
  return jsonb_build_object('skipped', false, 'sourceId', v_source_id, 'eventId', v_event_id);
end $$;

revoke execute on function public.ingest_source(text, text, timestamptz, text, text, jsonb, bigint, integer) from public, anon, authenticated;
grant execute on function public.ingest_source(text, text, timestamptz, text, text, jsonb, bigint, integer) to service_role;
