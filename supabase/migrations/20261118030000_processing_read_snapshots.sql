-- The live run spent 123 seconds in 34 section reads. The SQL wrapper
-- expanded its base expression more than once, and the base independently
-- repeated the same unit selection. Read one consistent snapshot instead.
create or replace function public.read_section_state_before_context(p_section_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_state jsonb := public.read_section_units(p_section_id);
  v_selected uuid[] := array(select (unit->>'unitId')::uuid from jsonb_array_elements(v_state->'units') unit);
begin
  return v_state || jsonb_build_object('lines', coalesce((
    select jsonb_agg(jsonb_build_object(
      'lineId', l.id, 'lineRevisionId', lr.id, 'position', l.position, 'content', lr.content,
      'author', lr.author,
      'unitIds', coalesce((select jsonb_agg(distinct r.unit_id) from public.revisions r where r.id=any(lr.unit_revision_ids)), '[]'),
      'needsRewrite', (exists(select 1 from public.stale_lines sl where sl.line_id=l.id)
        or exists(select 1 from public.revisions r where r.id=any(lr.unit_revision_ids) and r.unit_id<>all(v_selected)))
        and not exists(select 1 from public.exceptions e join public.actions a on a.id=e.action_id
          where e.reason='update_request' and a.target_id=l.id and a.input->>'expectedLineRevisionId'=lr.id::text)
    ) order by l.position,l.created_at)
    from public.lines l join public.line_revisions lr on lr.id=l.current_revision_id
    where l.section_id=p_section_id and l.retired_at is null), '[]'));
end $$;

create or replace function public.read_section_state(p_section_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with state as materialized (select public.read_section_state_before_context(p_section_id) as base)
  select jsonb_set(base,'{units}',coalesce((
    select jsonb_agg(unit||jsonb_build_object('context',r.knowledge_context) order by ordinality)
    from jsonb_array_elements(base->'units') with ordinality as e(unit,ordinality)
    left join public.revisions r on r.id=(unit->>'revisionId')::uuid
  ),'[]'::jsonb)) from state
$$;

revoke all on function public.read_section_state_before_context(uuid) from public,anon,authenticated;
revoke all on function public.read_section_state(uuid) from public,anon,authenticated;
grant execute on function public.read_section_state_before_context(uuid) to service_role;
grant execute on function public.read_section_state(uuid) to service_role;
notify pgrst,'reload schema';
