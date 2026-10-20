-- The section reader returns the stored query so a rebuild can drop a claim
-- the review found already stated here. The claim stays in the knowledge store.
create or replace function public.read_section_state(p_section_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with state as materialized (select public.read_section_state_before_context(p_section_id) as base)
  select base || jsonb_build_object(
    'units', coalesce((select jsonb_agg(unit||jsonb_build_object('context',r.knowledge_context) order by ordinality)
      from jsonb_array_elements(base->'units') with ordinality as e(unit,ordinality)
      left join public.revisions r on r.id=(unit->>'revisionId')::uuid),'[]'::jsonb),
    'lines', coalesce((select jsonb_agg(line||jsonb_build_object('unitRevisionIds',r.unit_revision_ids) order by ordinality)
      from jsonb_array_elements(base->'lines') with ordinality as e(line,ordinality)
      join public.line_revisions r on r.id=(line->>'lineRevisionId')::uuid),'[]'::jsonb),
    'query', (select s.query from public.sections s where s.id = p_section_id)
  ) from state
$$;
revoke all on function public.read_section_state(uuid) from public,anon,authenticated;
grant execute on function public.read_section_state(uuid) to service_role,space_runtime;
notify pgrst,'reload schema';
