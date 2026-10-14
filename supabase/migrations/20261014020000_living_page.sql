-- =====================================================================
-- SECOND BRAIN · LIVING PAGE FUNCTIONS
-- =====================================================================
-- The database side of rebuilding wiki sections after a commit. Server
-- code (lib/living-page) calls the public functions below through the
-- DbRpc port; the prose itself is written in app code (fake or model).
--
-- Section query shape (sections.query), every key optional:
--   { "entity": { "type", "key" }, "domainPaths": [..], "kinds": [..] }
--   entity       units linked to that entity (unit_entities)
--   domainPaths  units in one of those domains or any domain below it
--   kinds        units of one of those kinds
-- Only current units (retired_at is null) are selected. A null query
-- selects nothing; an empty object selects every current unit.
--
-- Public functions return jsonb with camelCase keys and run only for
-- service_role (server code holding the secret key).
-- =====================================================================


-- =====================================================================
-- INTERNAL HELPERS (called by the functions below, never by the API)
-- =====================================================================

-- UNITS A SECTION QUERY SELECTS (unordered)
create function public.living_page_query_units(p_query jsonb)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select u.id
  from public.units u
  where p_query is not null
    and u.retired_at is null
    -- ENTITY: linked to (type, key) when given
    and (
      jsonb_typeof(p_query -> 'entity') is distinct from 'object'
      or exists (
        select 1
        from public.unit_entities ue
        join public.entities e on e.id = ue.entity_id
        where ue.unit_id = u.id
          and e.type = p_query -> 'entity' ->> 'type'
          and e.key = p_query -> 'entity' ->> 'key'
      )
    )
    -- DOMAINS: in a listed domain or below it (compared by path prefix, not LIKE)
    and (
      jsonb_typeof(p_query -> 'domainPaths') is distinct from 'array'
      or jsonb_array_length(p_query -> 'domainPaths') = 0
      or exists (
        select 1
        from public.unit_domains ud
        join public.domains d on d.id = ud.domain_id
        cross join jsonb_array_elements_text(p_query -> 'domainPaths') as wanted(path)
        where ud.unit_id = u.id
          and (d.path = wanted.path or left(d.path, length(wanted.path) + 1) = wanted.path || '/')
      )
    )
    -- KINDS: one of the listed kinds
    and (
      jsonb_typeof(p_query -> 'kinds') is distinct from 'array'
      or jsonb_array_length(p_query -> 'kinds') = 0
      or u.kind::text in (select jsonb_array_elements_text(p_query -> 'kinds'))
    );
$$;

-- UNITS AN EVENT TOUCHED: targets of the actions it applied, and of the actions it undid.
-- A merge also touches the duplicates it retired (they may sit in other sections).
create function public.living_page_event_units(p_event_id uuid)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  with event_actions as (
    select a.type, a.target_id, a.input
    from public.actions a
    join public.change_sets cs on cs.id = a.change_set_id
    where cs.event_id = p_event_id and a.outcome = 'applied'
    union all
    select a.type, a.target_id, a.input
    from public.actions a
    where a.reverted_by_event_id = p_event_id
  )
  select ea.target_id from event_actions ea where ea.target_id is not null
  union
  select duplicate.id::uuid
  from event_actions ea
  cross join lateral jsonb_array_elements_text(
    case
      when ea.type = 'merge_duplicates' and jsonb_typeof(ea.input -> 'duplicateUnitIds') = 'array'
        then ea.input -> 'duplicateUnitIds'
      else '[]'::jsonb
    end
  ) as duplicate(id);
$$;

-- CHANGE NOTE LINE: what the event changed among the given units, and where it came from
create function public.living_page_change_summary(p_event_id uuid, p_unit_ids uuid[])
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cause public.event_cause;
  v_source_title text;
  v_changes text[];
  v_what text;
begin
  -- EVENT AND ITS SOURCE
  select e.cause, s.title into v_cause, v_source_title
  from public.shift_events e
  left join public.sources s on s.id = e.source_id
  where e.id = p_event_id;

  if v_cause = 'revert' then
    return 'Updated: undo of an earlier change';
  end if;

  -- TOUCHED UNITS OF THIS SECTION, CURRENT CONTENT (a retired one reads "removed ...")
  select array_agg(
           case when u.retired_at is not null then 'removed ' || r.content else r.content end
           order by u.valid_from, u.created_at, u.id
         )
  into v_changes
  from public.units u
  join public.revisions r on r.id = u.current_revision_id
  where u.id = any (p_unit_ids)
    and u.id in (select public.living_page_event_units(p_event_id));

  v_what := coalesce(v_changes[1], 'section rebuilt');
  if coalesce(array_length(v_changes, 1), 0) > 1 then
    v_what := v_what || ' (and ' || (array_length(v_changes, 1) - 1) || ' more)';
  end if;

  return 'Updated: ' || v_what || case
    when v_cause = 'upload' and v_source_title is not null then ' (from ' || v_source_title || ')'
    when v_cause = 'edit' then ' (edited by hand)'
    else ''
  end;
end;
$$;


-- =====================================================================
-- PUBLIC FUNCTIONS (service_role only)
-- =====================================================================

-- AFFECTED SECTIONS: generated sections whose query selects a touched unit,
-- or that were built from one. Returns [{ sectionId, pageId }]
create function public.list_affected_sections(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with touched as (
    select touched_id from public.living_page_event_units(p_event_id) as t(touched_id)
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('sectionId', s.id, 'pageId', s.page_id) order by s.page_id, s.position),
    '[]'::jsonb
  )
  from public.sections s
  where s.mode = 'generated'
    and (
      exists (
        select 1 from public.section_inputs si
        where si.section_id = s.id and si.unit_id in (select touched_id from touched)
      )
      or exists (
        select 1 from public.living_page_query_units(s.query) as q(unit_id)
        where q.unit_id in (select touched_id from touched)
      )
    );
$$;

-- PAGE SECTIONS: every generated section of one page. Returns [{ sectionId, pageId }]
create function public.list_page_sections(p_page_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('sectionId', s.id, 'pageId', s.page_id) order by s.position),
    '[]'::jsonb
  )
  from public.sections s
  where s.page_id = p_page_id and s.mode = 'generated';
$$;

-- SECTION UNITS: what the section's query selects now, oldest claim first.
-- Returns { sectionId, title, pageTitle, units: [{ unitId, revisionId, content, kind, epistemicStatus }] }
create function public.read_section_units(p_section_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
           'sectionId', s.id,
           'title', s.title,
           'pageTitle', p.title,
           'units', coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'unitId', u.id,
                        'revisionId', r.id,
                        'content', r.content,
                        'kind', u.kind,
                        'epistemicStatus', u.epistemic_status
                      )
                      order by u.valid_from, u.created_at, u.id
                    )
             from public.living_page_query_units(s.query) as q(unit_id)
             join public.units u on u.id = q.unit_id
             join public.revisions r on r.id = u.current_revision_id
           ), '[]'::jsonb)
         )
  into v_result
  from public.sections s
  join public.pages p on p.id = s.page_id
  where s.id = p_section_id;

  if v_result is null then
    raise exception 'Section % does not exist.', p_section_id;
  end if;
  return v_result;
end;
$$;

-- MARK BUILDING: open pages show the stale bar while the section is rewritten.
-- Returns { sectionId, status }
create function public.mark_section_building(p_section_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  update public.sections
  set status = 'building'
  where id = p_section_id
  returning jsonb_build_object('sectionId', id, 'status', status);
$$;

-- SAVE A BUILD: body, sentence links, inputs (replaced), status current, and a
-- change note when an event caused it.
-- p_build = { body, sentenceLinks: [{ start, end, unitIds }], modelVersion,
--             inputs: [{ unitId, revisionId }] }
-- Returns { sectionId, changeNoteId } (changeNoteId null without an event)
create function public.save_section_build(p_section_id uuid, p_event_id uuid, p_build jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inputs jsonb := coalesce(p_build -> 'inputs', '[]'::jsonb);
  v_unit_ids uuid[];
  v_note_id uuid;
begin
  -- UNITS BEFORE AND AFTER THIS BUILD (the note describes the touched ones among them)
  select array_agg(distinct unit_id) into v_unit_ids
  from (
    select si.unit_id from public.section_inputs si where si.section_id = p_section_id
    union all
    select x."unitId" from jsonb_to_recordset(v_inputs) as x("unitId" uuid, "revisionId" uuid)
  ) as before_and_after;

  -- SECTION TEXT
  update public.sections
  set body = coalesce(p_build ->> 'body', ''),
      sentence_links = coalesce(p_build -> 'sentenceLinks', '[]'::jsonb),
      status = 'current',
      built_at = now(),
      built_with_model_version = p_build ->> 'modelVersion'
  where id = p_section_id;
  if not found then
    raise exception 'Section % does not exist.', p_section_id;
  end if;

  -- INPUTS: replaced by what this build used
  delete from public.section_inputs where section_id = p_section_id;
  insert into public.section_inputs (section_id, unit_id, revision_id)
  select p_section_id, x."unitId", x."revisionId"
  from jsonb_to_recordset(v_inputs) as x("unitId" uuid, "revisionId" uuid);

  -- CHANGE NOTE
  if p_event_id is not null then
    insert into public.change_notes (section_id, event_id, summary)
    values (p_section_id, p_event_id, public.living_page_change_summary(p_event_id, coalesce(v_unit_ids, '{}')))
    returning id into v_note_id;
  end if;

  return jsonb_build_object('sectionId', p_section_id, 'changeNoteId', v_note_id);
end;
$$;


-- =====================================================================
-- ACCESS: server code only
-- =====================================================================

revoke execute on function public.living_page_query_units(jsonb) from public, anon, authenticated;
revoke execute on function public.living_page_event_units(uuid) from public, anon, authenticated;
revoke execute on function public.living_page_change_summary(uuid, uuid[]) from public, anon, authenticated;

revoke execute on function public.list_affected_sections(uuid) from public, anon, authenticated;
revoke execute on function public.list_page_sections(uuid) from public, anon, authenticated;
revoke execute on function public.read_section_units(uuid) from public, anon, authenticated;
revoke execute on function public.mark_section_building(uuid) from public, anon, authenticated;
revoke execute on function public.save_section_build(uuid, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.list_affected_sections(uuid) to service_role;
grant execute on function public.list_page_sections(uuid) to service_role;
grant execute on function public.read_section_units(uuid) to service_role;
grant execute on function public.mark_section_building(uuid) to service_role;
grant execute on function public.save_section_build(uuid, uuid, jsonb) to service_role;
