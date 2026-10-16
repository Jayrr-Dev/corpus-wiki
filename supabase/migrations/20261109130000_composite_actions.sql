-- =====================================================================
-- COMPOSITE ACTIONS (columns in 20261109120000_composites.sql)
--   add_claim / revise_claim  input.structure sets the composite's shape;
--                             a revise without it keeps the previous one
--   merge_duplicates          the claim that stays keeps a shape
--   link                      input.memberPosition orders a part_of into a sequence
--   set_member                moves a member within its composite, or takes it
--                             out (target = the composite, so it shows in its history)
-- =====================================================================

-- SHAPE: null, or {type: sequence|set, complete: boolean, mode: all|any|null}; mode is for sets
create function change_control.structure_problem(p_structure jsonb)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_structure is null or jsonb_typeof(p_structure) = 'null' then null
    when jsonb_typeof(p_structure) <> 'object' then 'A structure must be an object.'
    when coalesce(p_structure ->> 'type', '') not in ('sequence', 'set') then 'A structure is a sequence or a set.'
    when jsonb_typeof(p_structure -> 'complete') is distinct from 'boolean' then 'A structure says whether its list is complete.'
    when coalesce(p_structure ->> 'mode', 'null') not in ('null', 'all', 'any') then 'A set''s mode is all or any.'
    when p_structure ->> 'type' = 'sequence' and p_structure ->> 'mode' is not null then 'Only a set has a mode.'
  end
$$;

-- The composite a unit's current revision shapes, or null
create function change_control.unit_structure(p_unit uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select r.structure from public.units u join public.revisions r on r.id = u.current_revision_id
  where u.id = p_unit and u.retired_at is null
$$;

-- CHECK: a valid shape on add and revise (a bad one rejects the action, not the ChangeSet)
alter function change_control.check_references(public.actions) rename to check_references_before_structure;
create function change_control.check_references(p_action public.actions)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_problem text;
begin
  if p_action.type::text in ('add_claim', 'revise_claim') and p_action.input ? 'structure' then
    v_problem := change_control.structure_problem(p_action.input -> 'structure');
    if v_problem is not null then
      return change_control.check('references', false, v_problem);
    end if;
  end if;
  return change_control.check_references_before_structure(p_action);
end $$;

-- APPLY ADD: the new revision carries the shape
alter function change_control.apply_add_claim(public.actions, uuid, public.actor_kind) rename to apply_add_claim_before_structure;
create function change_control.apply_add_claim(p_action public.actions, p_event_id uuid, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform change_control.apply_add_claim_before_structure(p_action, p_event_id, p_author);
  if jsonb_typeof(p_action.input -> 'structure') = 'object' then
    update public.revisions set structure = p_action.input -> 'structure'
    where id = (select after_revision_id from public.actions where id = p_action.id);
  end if;
end $$;

-- APPLY REVISE: the shape carries over unless the input sets it (null clears it)
alter function change_control.apply_revise_claim(public.actions, uuid, public.actor_kind) rename to apply_revise_claim_before_structure;
create function change_control.apply_revise_claim(p_action public.actions, p_event_id uuid, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_structure jsonb;
begin
  select r.structure into v_structure from public.units u join public.revisions r on r.id = u.current_revision_id
  where u.id = p_action.target_id;
  if p_action.input ? 'structure' then
    v_structure := nullif(p_action.input -> 'structure', 'null'::jsonb);
  end if;
  perform change_control.apply_revise_claim_before_structure(p_action, p_event_id, p_author);
  update public.revisions set structure = v_structure
  where id = (select after_revision_id from public.actions where id = p_action.id);
end $$;

-- APPLY MERGE: the merged revision keeps the shape of the claim that stays, else a duplicate's
alter function change_control.apply_merge_duplicates(public.actions) rename to apply_merge_duplicates_before_structure;
create function change_control.apply_merge_duplicates(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_structure jsonb;
  v_after uuid;
begin
  select coalesce(
    (select r.structure from public.units u join public.revisions r on r.id = u.current_revision_id where u.id = p_action.target_id),
    (select r.structure from public.units u join public.revisions r on r.id = u.current_revision_id
     where u.id = any (change_control.uuid_array(p_action.input -> 'duplicateUnitIds')) and r.structure is not null
     order by u.created_at, u.id limit 1))
  into v_structure;
  perform change_control.apply_merge_duplicates_before_structure(p_action);
  select after_revision_id into v_after from public.actions where id = p_action.id;
  if v_after is not null and v_structure is not null then
    update public.revisions set structure = v_structure where id = v_after;
  end if;
end $$;

-- APPLY LINK: as in 20261014010000_change_control.sql, plus the member's position
create or replace function change_control.apply_link(p_action public.actions, p_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_from uuid := coalesce(p_action.target_id,
    change_control.unit_at_position(p_action.change_set_id, (p_action.input ->> 'fromPosition')::integer));
  v_to uuid := coalesce((p_action.input ->> 'toUnitId')::uuid,
    change_control.unit_at_position(p_action.change_set_id, (p_action.input ->> 'toPosition')::integer));
  v_relationship_id uuid;
begin
  insert into public.relationships (from_unit_id, to_unit_id, type, event_id, position)
  values (v_from, v_to, (p_action.input ->> 'type')::public.relationship_type, p_event_id,
          (p_action.input ->> 'memberPosition')::integer)
  returning id into v_relationship_id;
  update public.actions
  set target_id = v_from, undo_state = jsonb_build_object('relationshipId', v_relationship_id, 'compositeId', v_to)
  where id = p_action.id;
end $$;

-- CHECK: the 20261021010000 link rules; a member position needs a part_of into a sequence.
-- set_member needs a live composite and a live membership to change.
alter function change_control.check_link(public.actions) rename to check_link_before_members;
create function change_control.check_link(p_action public.actions)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_to uuid;
  v_structure jsonb;
  v_position jsonb := p_action.input -> 'memberPosition';
begin
  if p_action.type::text = 'set_member' then
    v_structure := change_control.unit_structure(p_action.target_id);
    if v_structure is null then
      return change_control.check('link', false, 'The composite is retired or has no structure.');
    end if;
    if not exists (
      select 1 from public.relationships r join public.units m on m.id = r.from_unit_id
      where r.to_unit_id = p_action.target_id and r.from_unit_id = (p_action.input ->> 'memberUnitId')::uuid
        and r.type = 'part_of' and r.retired_at is null and m.retired_at is null
    ) then
      return change_control.check('link', false, 'The claim is not a member of this composite.');
    end if;
    v_position := p_action.input -> 'position';
    if coalesce((p_action.input ->> 'remove')::boolean, false) then
      return change_control.check('link', true, null);
    end if;
    if v_structure ->> 'type' <> 'sequence' then
      return change_control.check('link', false, 'Only the steps of a sequence have positions.');
    end if;
    if jsonb_typeof(v_position) is distinct from 'number' or (v_position #>> '{}')::numeric < 1
       or (v_position #>> '{}')::numeric <> trunc((v_position #>> '{}')::numeric) then
      return change_control.check('link', false, 'A step''s position is a whole number from 1.');
    end if;
    return change_control.check('link', true, null);
  end if;

  if p_action.type::text = 'link' and v_position is not null and jsonb_typeof(v_position) <> 'null' then
    if p_action.input ->> 'type' <> 'part_of' then
      return change_control.check('link', false, 'Only a part_of link has a position.');
    end if;
    if jsonb_typeof(v_position) <> 'number' or (v_position #>> '{}')::numeric < 1
       or (v_position #>> '{}')::numeric <> trunc((v_position #>> '{}')::numeric) then
      return change_control.check('link', false, 'A step''s position is a whole number from 1.');
    end if;
    v_to := coalesce((p_action.input ->> 'toUnitId')::uuid,
      change_control.unit_at_position(p_action.change_set_id, (p_action.input ->> 'toPosition')::integer));
    if coalesce(change_control.unit_structure(v_to) ->> 'type', '') <> 'sequence' then
      return change_control.check('link', false, 'Only the steps of a sequence have positions.');
    end if;
  end if;
  return change_control.check_link_before_members(p_action);
end $$;

-- APPLY SET_MEMBER: a new position, or the membership retired
create function change_control.apply_set_member(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_link public.relationships;
begin
  select * into strict v_link from public.relationships
  where to_unit_id = p_action.target_id and from_unit_id = (p_action.input ->> 'memberUnitId')::uuid
    and type = 'part_of' and retired_at is null
  order by created_at, id limit 1
  for update;
  if coalesce((p_action.input ->> 'remove')::boolean, false) then
    update public.relationships set retired_at = now() where id = v_link.id;
  else
    update public.relationships set position = (p_action.input ->> 'position')::integer where id = v_link.id;
  end if;
  update public.actions
  set undo_state = jsonb_build_object('relationshipId', v_link.id, 'position', v_link.position,
                                      'removed', coalesce((p_action.input ->> 'remove')::boolean, false))
  where id = p_action.id;
end $$;

alter function change_control.apply_action(public.actions, uuid, public.actor_kind) rename to apply_action_before_members;
create function change_control.apply_action(p_action public.actions, p_event_id uuid, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_action.type::text <> 'set_member' then
    perform change_control.apply_action_before_members(p_action, p_event_id, p_author);
    return;
  end if;
  perform change_control.apply_set_member(p_action);
  update public.actions set outcome = 'applied', applied_at = now() where id = p_action.id;
end $$;

-- UNDO SET_MEMBER: the old position comes back, or the membership does
alter function change_control.undo_action(public.actions, uuid) rename to undo_action_before_members;
create function change_control.undo_action(p_action public.actions, p_revert_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_action.type::text <> 'set_member' then
    perform change_control.undo_action_before_members(p_action, p_revert_event_id);
    return;
  end if;
  if (p_action.undo_state ->> 'removed')::boolean then
    update public.relationships set retired_at = null where id = (p_action.undo_state ->> 'relationshipId')::uuid;
  else
    update public.relationships set position = (p_action.undo_state ->> 'position')::integer
    where id = (p_action.undo_state ->> 'relationshipId')::uuid;
  end if;
  update public.actions set outcome = 'reverted', reverted_by_event_id = p_revert_event_id where id = p_action.id;
end $$;

-- UNITS AN EVENT TOUCHED: as in 20261014020000_living_page.sql, plus the composite of a
-- part_of link and the member of a set_member, so the composite's sections rebuild
create or replace function public.living_page_event_units(p_event_id uuid)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  with event_actions as (
    select a.type, a.target_id, a.input
    from public.actions a
    join public.change_sets cs on cs.id = a.change_set_id
    where cs.event_id = p_event_id and a.outcome = 'applied'
    union all
    select a.type, a.target_id, a.input
    from public.actions a
    where a.reverted_by_event_id = p_event_id
  )
  select ea.target_id from event_actions ea where ea.target_id is not null
  union
  select duplicate.id::uuid
  from event_actions ea
  cross join lateral jsonb_array_elements_text(
    case
      when ea.type = 'merge_duplicates' and jsonb_typeof(ea.input -> 'duplicateUnitIds') = 'array'
        then ea.input -> 'duplicateUnitIds'
      else '[]'::jsonb
    end
  ) as duplicate(id)
  union
  select (ea.input ->> 'toUnitId')::uuid from event_actions ea
  where ea.type::text = 'link' and ea.input ->> 'type' = 'part_of' and ea.input ->> 'toUnitId' is not null
  union
  select (ea.input ->> 'memberUnitId')::uuid from event_actions ea
  where ea.type::text = 'set_member' and ea.input ->> 'memberUnitId' is not null;
$$;

-- RECONCILIATION INPUT: each existing unit also says its shape and its members, in order,
-- so a new file can revise a known procedure instead of starting another
alter function public.reconciliation_input(uuid) rename to reconciliation_input_before_structure;
create function public.reconciliation_input(p_event_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_set(base, '{existingUnits}', coalesce((
    select jsonb_agg(x || jsonb_build_object(
      'structure', r.structure,
      'memberUnitIds', coalesce((
        select jsonb_agg(l.from_unit_id order by l.position nulls last, l.created_at, l.id)
        from public.relationships l join public.units m on m.id = l.from_unit_id
        where l.to_unit_id = (x ->> 'unitId')::uuid and l.type = 'part_of' and l.retired_at is null and m.retired_at is null
      ), '[]'::jsonb)) order by ordinality)
    from jsonb_array_elements(base -> 'existingUnits') with ordinality as e(x, ordinality)
    left join public.revisions r on r.id = (x ->> 'revisionId')::uuid
  ), '[]'::jsonb))
  from (select public.reconciliation_input_before_structure(p_event_id) base) t
$$;
revoke all on function public.reconciliation_input(uuid) from public, anon, authenticated;
grant execute on function public.reconciliation_input(uuid) to service_role;

revoke execute on all functions in schema change_control from public, anon, authenticated;
