-- CHANGE NOTES NAME WHO EDITED
-- cause = 'edit' covers every change that is not an upload or an undo, including AI
-- rewrites and article updates. "(edited by hand)" now needs a person as the actor;
-- an AI edit reads "(AI rewrite)".

-- CHANGE NOTE LINE: what the event changed among the given units, and where it came from
create or replace function public.living_page_change_summary(p_event_id uuid, p_unit_ids uuid[])
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cause public.event_cause;
  v_actor public.actor_kind;
  v_source_title text;
  v_changes text[];
  v_what text;
begin
  -- EVENT AND ITS SOURCE
  select e.cause, e.actor, s.title into v_cause, v_actor, v_source_title
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
    when v_cause = 'edit' and v_actor = 'person' then ' (edited by hand)'
    when v_cause = 'edit' then ' (AI rewrite)'
    else ''
  end;
end;
$$;

-- RELABEL SAVED NOTES of AI edits that were marked as edited by hand
update public.change_notes n
set summary = left(n.summary, length(n.summary) - length(' (edited by hand)')) || ' (AI rewrite)'
from public.shift_events e
where e.id = n.event_id
  and e.actor = 'ai'
  and n.summary like '% (edited by hand)';
