-- =====================================================================
-- A CLAIM'S SECTIONS IN ONE PASS. 20261113900000 asked each generated
-- section whether it shows the claim, one function call per section,
-- twice per claim. Each call runs a whole living_page_query_units query
-- (functions with search_path set are not inlined): about 0.35 ms, so
-- 87 ms per claim with 131 sections, and an upload of ~90 claims passed
-- the 8 s statement timeout. The claim's facts (kind, entity links,
-- scope, domains) are now read once and every section's query is
-- checked against them in one statement, with the same rules as
-- living_page_query_units. Which sections go stale does not change.
-- =====================================================================

-- The generated sections whose query selects this unit (same answer as
-- living_page_query_has_unit for each section, retired sections included)
create function public.living_page_sections_with_unit(p_unit uuid)
returns setof uuid
language sql stable
set search_path = ''
as $$
  with unit as materialized (
    select u.id, u.kind::text as kind, r.knowledge_context as context
    from public.units u join public.revisions r on r.id = u.current_revision_id
    where u.id = p_unit and u.retired_at is null
  ),
  links as materialized (
    select ue.entity_id, ue.role::text as role from public.unit_entities ue where ue.unit_id = p_unit
  ),
  scope as materialized (
    select public.entity_id_for(e ->> 'type', e ->> 'key') as entity_id
    from unit cross join lateral jsonb_array_elements(unit.context -> 'applicability' -> 'entities') e
    where unit.context -> 'applicability' ->> 'status' = 'scoped'
  ),
  paths as materialized (
    select d.path from public.unit_domains ud join public.domains d on d.id = ud.domain_id where ud.unit_id = p_unit
  ),
  -- Sections that pass every filter but the entity one
  candidates as materialized (
    select s.id, s.query
    from public.sections s cross join unit
    where s.mode = 'generated' and s.query is not null
      and (jsonb_typeof(s.query -> 'unitIds') is distinct from 'array'
           or unit.id::text in (select jsonb_array_elements_text(s.query -> 'unitIds')))
      and (jsonb_typeof(s.query -> 'domainPaths') is distinct from 'array' or jsonb_array_length(s.query -> 'domainPaths') = 0
           or exists (select 1 from paths cross join jsonb_array_elements_text(s.query -> 'domainPaths') wanted(path)
                      where paths.path = wanted.path or starts_with(paths.path, wanted.path || '/')))
      and (jsonb_typeof(s.query -> 'kinds') is distinct from 'array' or jsonb_array_length(s.query -> 'kinds') = 0
           or unit.kind in (select jsonb_array_elements_text(s.query -> 'kinds')))
  ),
  -- Each queried entity resolved once, through merges
  wanted as materialized (
    select t.type, t.key, public.entity_id_for(t.type, t.key) as entity_id
    from (select distinct c.query -> 'entity' ->> 'type' as type, c.query -> 'entity' ->> 'key' as key
          from candidates c where jsonb_typeof(c.query -> 'entity') = 'object') t
  )
  select c.id
  from candidates c
  left join wanted w on jsonb_typeof(c.query -> 'entity') = 'object'
    and w.type is not distinct from c.query -> 'entity' ->> 'type' and w.key is not distinct from c.query -> 'entity' ->> 'key'
  where jsonb_typeof(c.query -> 'entity') is distinct from 'object'
    or exists (select 1 from links l where l.entity_id = w.entity_id
               and l.role in (select jsonb_array_elements_text(coalesce(c.query -> 'entityRoles', '["subject","object"]'::jsonb))))
    or exists (select 1 from scope where scope.entity_id = w.entity_id)
$$;
revoke execute on function public.living_page_sections_with_unit(uuid) from public, anon, authenticated;

-- PROJECTION: the 20261113900000 version, finding the claim's sections in one pass
create or replace function change_control.project_knowledge_context(p_unit uuid) returns uuid[] language plpgsql set search_path='' as $$
declare c jsonb; section_id uuid; old_sections uuid[]; affected uuid[]:='{}';
begin
 select r.knowledge_context into c from public.units u join public.revisions r on r.id=u.current_revision_id where u.id=p_unit;
 if c is null then c:=jsonb_build_object('entities','[]'::jsonb); end if;
 select array_agg(s.id) into old_sections from public.sections s where s.mode='generated' and (
  s.id in (select public.living_page_sections_with_unit(p_unit))
  or exists(select 1 from public.section_inputs si where si.section_id=s.id and si.unit_id=p_unit)
  or exists(select 1 from public.revisions r cross join lateral jsonb_array_elements(coalesce(r.knowledge_context->'applicability'->'entities','[]'::jsonb)) e
    where r.unit_id=p_unit and e->>'type'=s.query->'entity'->>'type' and e->>'key'=s.query->'entity'->>'key')
 );
 delete from public.unit_entities where unit_id=p_unit;
 insert into public.unit_entities(unit_id,entity_id,role)
 select distinct on (canonical) p_unit,canonical,role from (
  select public.entity_canonical_id(e.id) canonical,(x->>'role')::public.entity_role role,
   case x->>'role' when 'subject' then 0 when 'object' then 1 else 2 end strength
  from jsonb_array_elements(c->'entities') x join public.entities e on e.type=x->>'type' and e.key=x->>'key'
 ) links order by canonical,strength
 on conflict do nothing;
 for section_id in select s.id from public.sections s where s.mode='generated' and
 (s.id=any(coalesce(old_sections,'{}'::uuid[])) or s.id in (select public.living_page_sections_with_unit(p_unit))) loop
  perform public.mark_section_stale(section_id);
  affected:=array_append(affected,section_id);
 end loop;
 return affected;
end $$;

revoke execute on all functions in schema change_control from public, anon, authenticated;
