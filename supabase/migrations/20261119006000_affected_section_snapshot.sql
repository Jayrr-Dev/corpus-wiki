-- A large upload already cites its event's claims in most sections. Resolve
-- that event once and avoid evaluating every section query after a cache hit.
-- CASE is intentional: the planner may reorder the old OR predicates.
grant create on schema public to space_runtime;
create or replace function public.list_affected_sections_before_context(p_event_id uuid)
returns jsonb language sql stable security definer set search_path='' set jit=off as $$
  with touched as materialized (
    select touched_id from public.living_page_event_units(p_event_id) as t(touched_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('sectionId',s.id,'pageId',s.page_id)
    order by s.page_id,s.position),'[]'::jsonb)
  from public.sections s join public.pages p on p.id=s.page_id
  where s.mode='generated' and s.retired_at is null and p.retired_at is null
    and case
      when exists(select 1 from public.stale_lines sl where sl.section_id=s.id) then true
      when exists(select 1 from public.section_inputs si where si.section_id=s.id
        and si.unit_id in(select touched_id from touched)) then true
      else exists(select 1 from public.living_page_query_units(s.query) as q(unit_id)
        where q.unit_id in(select touched_id from touched))
    end
$$;

-- These nested evidence reads compile complex RLS/citation expressions. Keep
-- compilation out of the small per-section read budget without changing data.
alter function public.list_affected_sections(uuid) set jit=off;
alter function public.read_section_state(uuid) set jit=off;
revoke all on function public.list_affected_sections_before_context(uuid) from public,anon,authenticated;
grant execute on function public.list_affected_sections_before_context(uuid) to service_role;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
