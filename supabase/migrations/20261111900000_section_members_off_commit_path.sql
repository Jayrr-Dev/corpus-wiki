-- =====================================================================
-- MEMBER EXPANSION OFF THE COMMIT PATH. 20261109140000 wrapped
-- living_page_query_units to add a composite's members. Every claim a
-- commit applies runs that query once per generated section
-- (project_knowledge_context), and the wrapper made each sweep about half
-- again as slow (113 sections: 245 ms to 375 ms). A 26-action upload then
-- hit the statement timeout. The query goes back to the original; only
-- the page readers add members, through living_page_section_units. A
-- membership change still rebuilds the composite's sections: its events
-- touch the composite (living_page_event_units, 20261109130000).
-- =====================================================================

drop function public.living_page_query_units(jsonb);
alter function public.living_page_query_units_before_members(jsonb) rename to living_page_query_units;
revoke execute on function public.living_page_query_units(jsonb) from public, anon, authenticated;

-- WHAT A SECTION SHOWS: what its query selects, plus the live members of every composite in it
create function public.living_page_section_units(p_query jsonb)
returns setof uuid
language sql stable
set search_path = ''
as $$
  with selected as materialized (select public.living_page_query_units(p_query) as id)
  select id from selected
  union
  select l.from_unit_id
  from public.relationships l
  join selected s on s.id = l.to_unit_id
  where l.type = 'part_of' and l.retired_at is null
    and exists (select 1 from public.units c join public.revisions cr on cr.id = c.current_revision_id
                where c.id = l.to_unit_id and cr.structure is not null)
    and exists (select 1 from public.units m where m.id = l.from_unit_id and m.retired_at is null)
$$;
revoke execute on function public.living_page_section_units(jsonb) from public, anon, authenticated;

-- SECTION UNITS: the 20261109140000 version, reading the section's units with their members
create or replace function public.read_section_units(p_section_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  with picked as (
    select u.id, u.kind, u.epistemic_status, u.valid_from, u.created_at, r.id as revision_id, r.content, r.structure
    from public.sections s
    cross join lateral public.living_page_section_units(s.query) as q(unit_id)
    join public.units u on u.id = q.unit_id
    join public.revisions r on r.id = u.current_revision_id
    where s.id = p_section_id
  ),
  -- A member's composite among the picked units (the first one, when it is in several)
  placed as (
    select p.*, m.composite_id, m.position
    from picked p
    left join lateral (
      select c.id as composite_id, l.position
      from public.relationships l join picked c on c.id = l.to_unit_id and c.structure is not null
      where l.from_unit_id = p.id and l.type = 'part_of' and l.retired_at is null
      order by c.valid_from, c.created_at, c.id
      limit 1
    ) m on true
  )
  select jsonb_build_object(
           'sectionId', s.id,
           'title', s.title,
           'pageTitle', p.title,
           'units', coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'unitId', x.id,
                        'revisionId', x.revision_id,
                        'content', x.content,
                        'kind', x.kind,
                        'epistemicStatus', x.epistemic_status
                      )
                      || case when x.structure is not null then jsonb_build_object('structure', x.structure) else '{}'::jsonb end
                      || case when x.composite_id is not null then jsonb_build_object('memberOf', x.composite_id, 'position', x.position) else '{}'::jsonb end
                      order by coalesce(c.valid_from, x.valid_from), coalesce(c.created_at, x.created_at), coalesce(c.id, x.id),
                               x.composite_id is not null, x.position nulls last, x.created_at, x.id
                    )
             from placed x
             left join picked c on c.id = x.composite_id
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

-- SECTION STATE: the 20261026000000 version; a line citing a step of a composite the section
-- shows is not "no longer selected"
create or replace function public.read_section_state_before_context(p_section_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb := public.read_section_units(p_section_id);
  v_selected uuid[] := array(select public.living_page_section_units(
    (select query from public.sections where id = p_section_id)));
begin
  return v_state || jsonb_build_object('lines', coalesce((
    select jsonb_agg(jsonb_build_object(
      'lineId', l.id, 'lineRevisionId', lr.id, 'position', l.position, 'content', lr.content,
      'author', lr.author,
      'unitIds', coalesce((select jsonb_agg(distinct r.unit_id) from public.revisions r where r.id = any (lr.unit_revision_ids)), '[]'),
      'needsRewrite', (exists (select 1 from public.stale_lines sl where sl.line_id = l.id)
          or exists (select 1 from public.revisions r where r.id = any (lr.unit_revision_ids) and r.unit_id <> all (v_selected)))
        and not exists (
          select 1 from public.exceptions e join public.actions a on a.id = e.action_id
          where e.reason = 'update_request' and a.target_id = l.id
            and a.input ->> 'expectedLineRevisionId' = lr.id::text)
    ) order by l.position, l.created_at)
    from public.lines l join public.line_revisions lr on lr.id = l.current_revision_id
    where l.section_id = p_section_id and l.retired_at is null), '[]'));
end $$;
revoke all on function public.read_section_units(uuid) from public, anon, authenticated;
grant execute on function public.read_section_units(uuid) to service_role;
