-- =====================================================================
-- COMPOSITES ON PAGES: a section that shows a procedure or a list also
-- shows its steps or items, in order, right after it, and tells the
-- writer which claims are steps of which composite.
-- =====================================================================

-- SECTION QUERIES: what the 20261108100000 query selects, plus the live members of every
-- composite it selects (a step need not name the section's entity to belong to its procedure)
alter function public.living_page_query_units(jsonb) rename to living_page_query_units_before_members;
create function public.living_page_query_units(p_query jsonb)
returns setof uuid
language sql stable
set search_path = ''
as $$
  with selected as (select public.living_page_query_units_before_members(p_query) as id)
  select id from selected
  union
  select l.from_unit_id
  from selected s
  join public.units c on c.id = s.id
  join public.revisions cr on cr.id = c.current_revision_id and cr.structure is not null
  join public.relationships l on l.to_unit_id = c.id and l.type = 'part_of' and l.retired_at is null
  join public.units m on m.id = l.from_unit_id and m.retired_at is null
$$;

-- SECTION UNITS: as in 20261014020000_living_page.sql, but a composite's members follow it in
-- their order, and each unit says its shape (structure) or its place (memberOf, position)
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
    cross join lateral public.living_page_query_units(s.query) as q(unit_id)
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

-- SECTION STATE: the 20261105180000 version, keeping the units' order while it adds their context
create or replace function public.read_section_state(p_section_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_set(base,'{units}',coalesce((select jsonb_agg(x||jsonb_build_object('context',r.knowledge_context) order by ordinality)
 from jsonb_array_elements(base->'units') with ordinality as e(x, ordinality) left join public.revisions r on r.id=(x->>'revisionId')::uuid),'[]'::jsonb))
 from (select public.read_section_state_before_context(p_section_id) base) t
$$;
revoke all on function public.read_section_state(uuid) from public,anon,authenticated;
grant execute on function public.read_section_state(uuid) to service_role;
revoke all on function public.read_section_units(uuid) from public,anon,authenticated;
grant execute on function public.read_section_units(uuid) to service_role;
revoke execute on function public.living_page_query_units(jsonb) from public, anon, authenticated;
