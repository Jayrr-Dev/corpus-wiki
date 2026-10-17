-- The context-correction UNION discarded the original section order. Restore
-- page order after including both current matches and earlier context matches.
create or replace function public.list_affected_sections(p_event_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with affected as (
   select (value->>'sectionId')::uuid section_id
   from jsonb_array_elements(public.list_affected_sections_before_context(p_event_id))
   union
   select previous.id::uuid
   from public.actions a join public.change_sets cs on cs.id=a.change_set_id
   cross join lateral jsonb_array_elements_text(coalesce(a.undo_state->'contextSectionIds','[]'::jsonb)) previous(id)
   where (cs.event_id=p_event_id and a.outcome='applied') or a.reverted_by_event_id=p_event_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('sectionId',s.id,'pageId',s.page_id)
   order by s.page_id,s.position,s.id),'[]'::jsonb)
 from affected a join public.sections s on s.id=a.section_id join public.pages p on p.id=s.page_id
 where s.mode='generated' and s.retired_at is null and p.retired_at is null
$$;
revoke all on function public.list_affected_sections(uuid) from public,anon,authenticated;
grant execute on function public.list_affected_sections(uuid) to service_role;
