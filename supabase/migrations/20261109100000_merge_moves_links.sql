-- =====================================================================
-- MERGES MOVE LINKS. Merging duplicates used to retire them with their
-- relationships still attached, so a merged claim silently dropped out of
-- everything it was linked to (a step out of its procedure). The links now
-- move to the claim that stays; undo moves them back.
-- Linking a claim also no longer blocks undoing the claim itself.
-- =====================================================================

-- APPLY: after the merge, re-point each live link of a duplicate at the claim that stays.
-- A link that would join the claim to itself, or repeat a live link, is retired instead.
alter function change_control.apply_merge_duplicates(public.actions) rename to apply_merge_duplicates_before_links;
create function change_control.apply_merge_duplicates(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_into uuid := p_action.target_id;
  v_duplicates uuid[] := change_control.uuid_array(p_action.input -> 'duplicateUnitIds');
  v_link public.relationships;
  v_from uuid;
  v_to uuid;
  v_moved jsonb := '[]';
  v_retired jsonb := '[]';
begin
  perform change_control.apply_merge_duplicates_before_links(p_action);
  for v_link in
    select * from public.relationships
    where retired_at is null and (from_unit_id = any (v_duplicates) or to_unit_id = any (v_duplicates))
    order by created_at, id
    for update
  loop
    v_from := case when v_link.from_unit_id = any (v_duplicates) then v_into else v_link.from_unit_id end;
    v_to := case when v_link.to_unit_id = any (v_duplicates) then v_into else v_link.to_unit_id end;
    if v_from = v_to or exists (
      select 1 from public.relationships other
      where other.id <> v_link.id and other.retired_at is null and other.type = v_link.type
        and ((other.from_unit_id = v_from and other.to_unit_id = v_to)
          or (v_link.type in ('related_to', 'contradicts') and other.from_unit_id = v_to and other.to_unit_id = v_from))
    ) then
      update public.relationships set retired_at = now() where id = v_link.id;
      v_retired := v_retired || to_jsonb(v_link.id);
    else
      update public.relationships set from_unit_id = v_from, to_unit_id = v_to where id = v_link.id;
      v_moved := v_moved || jsonb_build_object('id', v_link.id, 'from', v_link.from_unit_id, 'to', v_link.to_unit_id);
    end if;
  end loop;
  -- Read back: the base merge wrote undo_state after p_action was loaded
  update public.actions
  set undo_state = coalesce(undo_state, '{}') || jsonb_build_object('movedLinks', v_moved, 'retiredLinks', v_retired)
  where id = p_action.id;
end $$;

-- UNDO: moved links go back to the duplicate, retired ones come back. A link that was
-- changed or retired again since is left as it is.
alter function change_control.undo_action(public.actions, uuid) rename to undo_action_before_links;
create function change_control.undo_action(p_action public.actions, p_revert_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_link jsonb;
begin
  if p_action.type::text = 'merge_duplicates' then
    for v_link in select value from jsonb_array_elements(coalesce(p_action.undo_state -> 'movedLinks', '[]')) loop
      update public.relationships
      set from_unit_id = (v_link ->> 'from')::uuid, to_unit_id = (v_link ->> 'to')::uuid
      where id = (v_link ->> 'id')::uuid and retired_at is null;
    end loop;
    update public.relationships set retired_at = null
    where retired_at is not null
      and id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(p_action.undo_state -> 'retiredLinks', '[]')));
  end if;
  perform change_control.undo_action_before_links(p_action, p_revert_event_id);
end $$;

-- UNDO BLOCKING: as in 20261107120000_place_claim.sql, but a later link (or membership
-- change) on a claim no longer blocks undoing the claim. Links are undone on their own.
create or replace function change_control.unit_moved_since(p_action public.actions)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.actions later
    where later.target_id = p_action.target_id and later.outcome = 'applied'
      and later.applied_at > p_action.applied_at and later.id <> p_action.id
      and later.type::text not in ('place_claim', 'link', 'set_member')
      and p_action.type::text in ('add_claim', 'revise_claim', 'retire_claim', 'set_epistemic_status',
                                  'write_line', 'revise_line', 'retire_line', 'move_line',
                                  'create_page', 'rename_page', 'retire_page',
                                  'create_section', 'rename_section', 'retire_section',
                                  'update_entity', 'retire_entity', 'update_domain', 'retire_domain')
  )
$$;

revoke execute on all functions in schema change_control from public, anon, authenticated;
