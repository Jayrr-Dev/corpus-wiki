-- =====================================================================
-- UPDATE REQUESTS: a line a person wrote is theirs. When the AI wants to
-- rewrite or remove it (its claim changed, a restructure, a refresh), the
-- change is held as an exception with reason update_request and applies
-- only when the person accepts it on the Exceptions screen.
--   check_person_line   the new check: AI + revise/retire_line + the
--                       line's current revision written by a person
--   judge               sends a failed person_line check to a person
--   raise_exception     keeps the line's current text in the evidence,
--                       so the card can show it beside the proposal
--   accept_held_action  refuses a held line change when the line moved
--                       since the question was asked
--   read_section_state  stops flagging a person's line for rewrite once
--                       the AI has asked about that exact version, so
--                       reopening the page does not ask again
-- =====================================================================

alter type public.exception_reason add value if not exists 'update_request';

-- PERSON LINE: the AI may not change a person's current text on its own
create or replace function change_control.check_person_line(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language sql stable
set search_path = ''
as $$
  select case
    when p_proposed_by = 'ai' and p_action.type::text in ('revise_line', 'retire_line') and exists (
      select 1 from public.lines l join public.line_revisions lr on lr.id = l.current_revision_id
      where l.id = p_action.target_id and lr.author = 'person'
    )
    then change_control.check('person_line', false,
      case when p_action.type::text = 'retire_line'
        then 'A person wrote this line; the AI wants to remove it.'
        else 'A person wrote this line; the AI wants to rewrite it.' end)
  end
$$;

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
    change_control.check_deletion(p_action, p_proposed_by),
    change_control.check_person_line(p_action, p_proposed_by)
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
      when 'person_line' then v_outcome := 'exception'; v_reason := 'update_request';
      else v_outcome := 'rejected'; v_reason := null;
    end case;
  end loop;
  return jsonb_build_object('outcome', v_outcome, 'reason', v_reason, 'detail', v_detail, 'checks', v_checks);
end $$;

-- HOLD AN ACTION FOR A PERSON, with the evidence they need to decide
-- (a line action also keeps the line's text as it stands now)
create or replace function change_control.raise_exception(p_action public.actions, p_reason public.exception_reason, p_detail text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.actions set outcome = 'exception' where id = p_action.id;
  insert into public.exceptions (action_id, reason, evidence)
  values (
    p_action.id, p_reason,
    jsonb_build_object(
      'quote', change_control.evidence_quote(p_action.passage_ids),
      'passageIds', to_jsonb(p_action.passage_ids),
      'detail', p_detail
    ) || coalesce((
      select jsonb_build_object('lineText', lr.content)
      from public.lines l join public.line_revisions lr on lr.id = l.current_revision_id
      where p_action.type::text like '%\_line' and l.id = p_action.target_id
    ), '{}')
  );
end $$;

-- ACCEPT: apply the held action, unless its unit or line moved since it was drafted
create or replace function change_control.accept_held_action(p_action public.actions, p_set public.change_sets)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if p_action.expected_revision_id is not null and exists (
    select 1 from public.units where id = p_action.target_id and current_revision_id <> p_action.expected_revision_id
  ) then
    raise exception 'This knowledge changed since the question was asked. Reject it and upload again.';
  end if;
  if p_action.input ? 'expectedLineRevisionId' and exists (
    select 1 from public.lines where id = p_action.target_id
      and (retired_at is not null or current_revision_id <> (p_action.input ->> 'expectedLineRevisionId')::uuid)
  ) then
    raise exception 'This line was edited since the AI asked. Reject this request; the AI asks again about the new text if it still needs to.';
  end if;
  perform change_control.apply_action(p_action, p_set.event_id, p_set.proposed_by);
  perform change_control.refresh_status(p_set.id);
  return jsonb_build_object('eventId', p_set.event_id);
end $$;

-- SECTION STATE: as before, except a person's line the AI already asked
-- about (open or answered) at its current version is not flagged again
create or replace function public.read_section_state(p_section_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb := public.read_section_units(p_section_id);
  v_selected uuid[] := array(select public.living_page_query_units(
    (select query from public.sections where id = p_section_id)));
begin
  return v_state || jsonb_build_object('lines', coalesce((
    select jsonb_agg(jsonb_build_object(
      'lineId', l.id, 'lineRevisionId', lr.id, 'position', l.position, 'content', lr.content,
      'author', lr.author,
      'unitIds', coalesce((select jsonb_agg(distinct r.unit_id) from public.revisions r where r.id = any (lr.unit_revision_ids)), '[]'),
      'needsRewrite', (exists (select 1 from public.stale_lines sl where sl.line_id = l.id)
          or exists (select 1 from public.revisions r where r.id = any (lr.unit_revision_ids) and r.unit_id <> all (v_selected)))
        and not exists (
          select 1 from public.exceptions e join public.actions a on a.id = e.action_id
          where e.reason = 'update_request' and a.target_id = l.id
            and a.input ->> 'expectedLineRevisionId' = lr.id::text)
    ) order by l.position, l.created_at)
    from public.lines l join public.line_revisions lr on lr.id = l.current_revision_id
    where l.section_id = p_section_id and l.retired_at is null), '[]'));
end $$;

revoke execute on function change_control.check_person_line(public.actions, public.actor_kind) from public, anon, authenticated;
