-- =====================================================================
-- SECOND BRAIN · INGESTION (AGENT C)
-- =====================================================================
-- The database half of an upload. Server code stores the file in the
-- private 'sources' bucket and extracts its text; these functions record
-- the source, its passages and the Knowledge Shift Event, and hand the
-- model everything it needs to draft a ChangeSet.
--
--   ingest_source         source + passages + 'received' event (skips a known hash)
--   reconciliation_input  the file's passages and the current store, for the model
--   set_event_status      move an event along (and record why it failed)
-- =====================================================================


-- =====================================================================
-- PUBLIC: RECORD AN UPLOADED FILE
-- p_passages: [{ position, text, location, hash, speakerLabel }]
-- Returns { skipped: true, sourceId } when the same bytes were uploaded
-- before, else { skipped: false, sourceId, eventId }.
-- =====================================================================

create function public.ingest_source(
  p_title text,
  p_mime_type text,
  p_source_date timestamptz,
  p_hash text,
  p_storage_path text,
  p_passages jsonb
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
  insert into public.sources (title, mime_type, source_date, hash, storage_path)
  values (p_title, p_mime_type, p_source_date, p_hash, p_storage_path)
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


-- =====================================================================
-- PUBLIC: WHAT THE MODEL SEES FOR ONE UPLOAD EVENT
-- (lib/ai/types.ts ReconciliationInput). No vectors: the whole current
-- store fits in the prompt for the prototype's few dozen units.
-- =====================================================================

create function public.reconciliation_input(p_event_id uuid)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'source', jsonb_build_object('id', s.id, 'title', s.title, 'sourceDate', s.source_date),
    'passages', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'position', p.position, 'text', p.text, 'speakerLabel', p.speaker_label)
                       order by p.position)
      from public.passages p where p.source_id = s.id), '[]'),
    'existingUnits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unitId', u.id, 'revisionId', r.id, 'content', r.content, 'kind', u.kind,
        'epistemicStatus', u.epistemic_status, 'sourceDate', r.source_date, 'passageIds', to_jsonb(r.passage_ids)
      ) order by u.created_at)
      from public.units u join public.revisions r on r.id = u.current_revision_id
      where u.retired_at is null), '[]'),
    'domainPaths', coalesce((select jsonb_agg(d.path order by d.path) from public.domains d), '[]'),
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object('type', e.type, 'key', e.key, 'name', e.name) order by e.type, e.key)
      from public.entities e where e.merged_into_id is null), '[]')
  )
  from public.shift_events ev join public.sources s on s.id = ev.source_id
  where ev.id = p_event_id
$$;


-- =====================================================================
-- PUBLIC: MOVE AN EVENT ALONG ('failed' records the error and finishes it)
-- =====================================================================

create function public.set_event_status(p_event_id uuid, p_status public.event_status, p_error text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  update public.shift_events
  set status = p_status,
      error = p_error,
      finished_at = case when p_status in ('applied', 'partly_applied', 'failed', 'reverted') then now() end
  where id = p_event_id
  returning jsonb_build_object('eventId', id, 'status', status)
$$;


-- =====================================================================
-- ACCESS: only server code (secret key = service_role) may call these
-- =====================================================================

revoke execute on function public.ingest_source(text, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.reconciliation_input(uuid) from public, anon, authenticated;
revoke execute on function public.set_event_status(uuid, public.event_status, text) from public, anon, authenticated;
grant execute on function public.ingest_source(text, text, timestamptz, text, text, jsonb) to service_role;
grant execute on function public.reconciliation_input(uuid) to service_role;
grant execute on function public.set_event_status(uuid, public.event_status, text) to service_role;
