-- Section completion reads this snapshot repeatedly. Carrying every action's
-- full input spills large extraction/write payloads to disk even though only
-- merge and composite-link actions need any fields from that input.
create or replace function public.living_page_event_units(p_event_id uuid)
returns setof uuid language sql stable set search_path='' as $$
  with event_actions as materialized (
    select a.type, a.target_id,
      case when a.type::text in ('merge_duplicates','link','set_member') then a.input end as input
    from public.actions a join public.change_sets cs on cs.id=a.change_set_id
    where cs.event_id=p_event_id and a.outcome='applied'
    union all
    select a.type, a.target_id,
      case when a.type::text in ('merge_duplicates','link','set_member') then a.input end
    from public.actions a where a.reverted_by_event_id=p_event_id
  )
  select ea.target_id from event_actions ea where ea.target_id is not null
  union
  select duplicate.id::uuid from event_actions ea
  cross join lateral jsonb_array_elements_text(
    case when ea.type='merge_duplicates' and jsonb_typeof(ea.input->'duplicateUnitIds')='array'
      then ea.input->'duplicateUnitIds' else '[]'::jsonb end
  ) as duplicate(id)
  union
  select (ea.input->>'toUnitId')::uuid from event_actions ea
  where ea.type::text='link' and ea.input->>'type'='part_of' and ea.input->>'toUnitId' is not null
  union
  select (ea.input->>'memberUnitId')::uuid from event_actions ea
  where ea.type::text='set_member' and ea.input->>'memberUnitId' is not null;
$$;
