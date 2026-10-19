-- =====================================================================
-- UPDATE A SECTION'S CLAIMS. The article scaffold keeps a same-title
-- section whose claims overlap the reviewed plan, instead of retiring and
-- rewriting it. Its query then gains the new claims (uncovered lines) and
-- drops the removed ones (citing lines need a rewrite). Undoable from Changes.
--
--   update_section_query { query: the new query, fromQuery: the query it had }
-- target = the section.
-- =====================================================================

alter type public.action_type add value if not exists 'update_section_query';

-- CHECK: a live generated section on a live page, still holding the query it was planned against
alter function change_control.check_page(public.actions, public.actor_kind) rename to check_page_before_section_query;
create function change_control.check_page(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_section public.sections;
begin
  if p_action.type::text <> 'update_section_query' then
    return change_control.check_page_before_section_query(p_action, p_proposed_by);
  end if;
  select * into v_section from public.sections where id = p_action.target_id;
  if v_section.id is null or v_section.retired_at is not null
     or not exists (select 1 from public.pages where id = v_section.page_id and retired_at is null) then
    return change_control.check('page', false, 'The section does not exist or was removed.');
  end if;
  if v_section.mode <> 'generated' then
    return change_control.check('page', false, 'Only generated sections take a new claim list.');
  end if;
  if jsonb_typeof(p_action.input -> 'query') is distinct from 'object' then
    return change_control.check('page', false, 'The new claim list is missing.');
  end if;
  if v_section.query is distinct from p_action.input -> 'fromQuery' then
    return change_control.check('page', false, 'The section''s claims changed since this was planned.');
  end if;
  return change_control.check('page', true, null);
end $$;

-- APPLY: the old query goes in undo_state
alter function change_control.apply_action(public.actions, uuid, public.actor_kind) rename to apply_action_before_section_query;
create function change_control.apply_action(p_action public.actions, p_event_id uuid, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb;
begin
  if p_action.type::text <> 'update_section_query' then
    perform change_control.apply_action_before_section_query(p_action, p_event_id, p_author);
    return;
  end if;
  select query into v_old from public.sections where id = p_action.target_id for update;
  update public.sections set query = p_action.input -> 'query' where id = p_action.target_id;
  update public.actions set undo_state = jsonb_build_object('query', v_old), outcome = 'applied', applied_at = now()
  where id = p_action.id;
end $$;

-- UNDO: the old query comes back; refused when the section changed since
alter function change_control.undo_action(public.actions, uuid) rename to undo_action_before_section_query;
create function change_control.undo_action(p_action public.actions, p_revert_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_section public.sections;
begin
  if p_action.type::text <> 'update_section_query' then
    perform change_control.undo_action_before_section_query(p_action, p_revert_event_id);
    return;
  end if;
  select * into v_section from public.sections where id = p_action.target_id for update;
  if v_section.id is null or v_section.retired_at is not null or v_section.query is distinct from p_action.input -> 'query' then
    raise exception 'This section changed again later. Undo that change first.';
  end if;
  update public.sections set query = p_action.undo_state -> 'query' where id = p_action.target_id;
  update public.actions set outcome = 'reverted', reverted_by_event_id = p_revert_event_id where id = p_action.id;
end $$;

revoke all on function change_control.check_page(public.actions, public.actor_kind),
  change_control.check_page_before_section_query(public.actions, public.actor_kind),
  change_control.apply_action(public.actions, uuid, public.actor_kind),
  change_control.apply_action_before_section_query(public.actions, uuid, public.actor_kind),
  change_control.undo_action(public.actions, uuid),
  change_control.undo_action_before_section_query(public.actions, uuid) from public, anon, authenticated;
grant execute on function change_control.check_page(public.actions, public.actor_kind),
  change_control.check_page_before_section_query(public.actions, public.actor_kind),
  change_control.apply_action(public.actions, uuid, public.actor_kind),
  change_control.apply_action_before_section_query(public.actions, uuid, public.actor_kind),
  change_control.undo_action(public.actions, uuid),
  change_control.undo_action_before_section_query(public.actions, uuid) to service_role, space_runtime;
grant create on schema change_control to space_runtime;
alter function change_control.check_page(public.actions, public.actor_kind) owner to space_runtime;
alter function change_control.apply_action(public.actions, uuid, public.actor_kind) owner to space_runtime;
alter function change_control.undo_action(public.actions, uuid) owner to space_runtime;
revoke create on schema change_control from space_runtime;
notify pgrst, 'reload schema';
