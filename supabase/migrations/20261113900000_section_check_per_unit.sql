-- =====================================================================
-- SECTION CHECK PER UNIT. Every claim a commit saves runs
-- project_knowledge_context, which asked of every generated section
-- whether the claim is in it, twice, by computing the section's whole
-- unit list. With ~110 sections that is about half a second per claim:
-- a 12-step procedure (54 actions) took 12 s to commit, past the 8 s
-- statement timeout. The question is now asked of the one unit.
-- =====================================================================

-- Whether a section query selects this unit: the same filters, narrowed to it
create or replace function public.living_page_query_has_unit(p_query jsonb, p_unit uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_query is not null and p_unit is not null
    and (jsonb_typeof(p_query -> 'unitIds') is distinct from 'array'
         or p_unit::text in (select jsonb_array_elements_text(p_query -> 'unitIds')))
    and exists (select 1 from public.living_page_query_units(jsonb_set(p_query, '{unitIds}', jsonb_build_array(p_unit))) q(id) where q.id = p_unit)
$$;
revoke execute on function public.living_page_query_has_unit(jsonb, uuid) from public, anon, authenticated;

-- The 20261108100000 version, with the membership checks above
create or replace function change_control.project_knowledge_context(p_unit uuid) returns uuid[] language plpgsql set search_path='' as $$
declare c jsonb; section_id uuid; old_sections uuid[]; affected uuid[]:='{}';
begin
 select r.knowledge_context into c from public.units u join public.revisions r on r.id=u.current_revision_id where u.id=p_unit;
 if c is null then c:=jsonb_build_object('entities','[]'::jsonb); end if;
 select array_agg(s.id) into old_sections from public.sections s where s.mode='generated' and (
  public.living_page_query_has_unit(s.query, p_unit)
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
 (s.id=any(coalesce(old_sections,'{}'::uuid[])) or public.living_page_query_has_unit(s.query, p_unit)) loop
  perform public.mark_section_stale(section_id);
  affected:=array_append(affected,section_id);
 end loop;
 return affected;
end $$;

revoke execute on all functions in schema change_control from public, anon, authenticated;
