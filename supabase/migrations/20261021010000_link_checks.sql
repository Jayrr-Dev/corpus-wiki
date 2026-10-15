-- =====================================================================
-- LINK CHECKS: ingest now proposes typed links between claims. A link
-- names a new claim by its add_claim's position, and that claim may
-- itself have been rejected or sent to a person, so the link's end can
-- be missing by the time it is judged. Without a check, apply_link would
-- insert a null and abort the whole ChangeSet. This rejects just the
-- link instead, and also rejects links to retired units, self links and
-- links that already exist.
-- =====================================================================

-- LINK: both ends resolve to live, different units, and the link is new
create function change_control.check_link(p_action public.actions)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_type public.relationship_type;
  v_from uuid;
  v_to uuid;
begin
  if p_action.type <> 'link' then
    return null;
  end if;
  v_type := (p_action.input ->> 'type')::public.relationship_type;
  v_from := coalesce(p_action.target_id,
    change_control.unit_at_position(p_action.change_set_id, (p_action.input ->> 'fromPosition')::integer));
  v_to := coalesce((p_action.input ->> 'toUnitId')::uuid,
    change_control.unit_at_position(p_action.change_set_id, (p_action.input ->> 'toPosition')::integer));
  if v_from is null or v_to is null then
    return change_control.check('link', false, 'A linked unit was not created.');
  end if;
  if v_from = v_to then
    return change_control.check('link', false, 'A unit cannot link to itself.');
  end if;
  if exists (select 1 from public.units where id in (v_from, v_to) and retired_at is not null) then
    return change_control.check('link', false, 'A linked unit is retired.');
  end if;
  -- related_to and contradicts read both ways, so the reverse pair is the same link
  if exists (
    select 1 from public.relationships r
    where r.retired_at is null and r.type = v_type
      and ((r.from_unit_id = v_from and r.to_unit_id = v_to)
        or (v_type in ('related_to', 'contradicts') and r.from_unit_id = v_to and r.to_unit_id = v_from))
  ) then
    return change_control.check('link', false, 'The units are already linked.');
  end if;
  return change_control.check('link', true, null);
end $$;

-- ALL CHECKS FOR ONE ACTION: as before (catalog_edits), plus the link check
create or replace function change_control.judge(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_checks jsonb := '[]';
  v_check jsonb;
  v_outcome text := 'applied';
  v_reason text;
  v_detail text;
begin
  foreach v_check in array array[
    change_control.check_target(p_action),
    change_control.check_catalog_target(p_action),
    change_control.check_line(p_action),
    change_control.check_page(p_action, p_proposed_by),
    change_control.check_references(p_action),
    change_control.check_link(p_action),
    change_control.check_source_date(p_action, p_proposed_by),
    change_control.check_decision(p_action),
    change_control.check_deletion(p_action, p_proposed_by)
  ] loop
    continue when v_check is null;
    v_checks := v_checks || v_check;
    continue when (v_check ->> 'passed')::boolean or v_outcome = 'rejected';
    v_detail := v_check ->> 'detail';
    -- A failed target, line, page, reference, link or date check rejects; the rest ask a person
    case v_check ->> 'name'
      when 'source_tie' then v_outcome := 'exception'; v_reason := 'source_tie';
      when 'decision' then v_outcome := 'exception'; v_reason := 'decision_conflict';
      when 'deletion' then v_outcome := 'exception'; v_reason := 'deletion';
      else v_outcome := 'rejected'; v_reason := null;
    end case;
  end loop;
  return jsonb_build_object('outcome', v_outcome, 'reason', v_reason, 'detail', v_detail, 'checks', v_checks);
end $$;
