-- =====================================================================
-- RETYPE AN ENTITY. A Change control action that moves an entity to another
-- type from public.entity_types: the reclassify pass uses it to move the
-- entities extraction filed as "concept" onto the type that fits
-- (lib/knowledge/entityReclassify.ts). Undoable from Changes.
--
-- An entity's (type, key) is how claim revisions name it, and revisions are
-- immutable, so the old (type, key) stays behind as a stub merged into the
-- entity (as in 20261111100000_entity_types.sql): old references resolve
-- through entity_canonical_id. A merged or retired row already holding the
-- new (type, key) gives its slot up (its key is suffixed; undo restores it).
-- A live entity holding it is a duplicate, not a retype: the check rejects.
--
-- input: { type: the new type, fromType: the type it had, reason }
-- =====================================================================

alter type public.action_type add value if not exists 'retype_entity';

-- A stub merged into its entity may keep a type that is no longer in use
create or replace function public.entities_require_active_type() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.merged_into_id is null and not exists (select 1 from public.entity_types t where t.type = new.type and t.active) then
    raise exception 'Entity type "%" is not in use; choose a type from public.entity_types', new.type;
  end if;
  return new;
end $$;

-- CHECK: the entity is live, the new type is in use and differs, and no live entity holds the slot
alter function change_control.check_catalog_target(public.actions) rename to check_catalog_target_before_retype;
create function change_control.check_catalog_target(p_action public.actions)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entity public.entities;
  v_type text := p_action.input ->> 'type';
begin
  if p_action.type::text <> 'retype_entity' then
    return change_control.check_catalog_target_before_retype(p_action);
  end if;
  select * into v_entity from public.entities where id = p_action.target_id;
  if v_entity.id is null then
    return change_control.check('target', false, 'The entity does not exist.');
  end if;
  if v_entity.retired_at is not null or v_entity.merged_into_id is not null then
    return change_control.check('target', false, 'The entity is retired or merged.');
  end if;
  if v_entity.type is distinct from p_action.input ->> 'fromType' then
    return change_control.check('target', false, 'The entity''s type changed since this was proposed.');
  end if;
  if not exists (select 1 from public.entity_types t where t.type = v_type and t.active) or v_type = v_entity.type then
    return change_control.check('target', false, 'Choose a different type that is in use.');
  end if;
  if exists (select 1 from public.entities e where e.type = v_type and e.key = v_entity.key and e.id <> v_entity.id
             and e.merged_into_id is null and e.retired_at is null) then
    return change_control.check('target', false, 'A live ' || v_type || ' with this key already exists; merge the two instead.');
  end if;
  return change_control.check('target', true, null);
end $$;

-- APPLY
create function change_control.apply_retype_entity(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_entity public.entities;
  v_type text := p_action.input ->> 'type';
  v_clash public.entities;
  v_stub uuid;
begin
  select * into v_entity from public.entities where id = p_action.target_id for update;
  select * into v_clash from public.entities where type = v_type and key = v_entity.key for update;
  if v_clash.id is not null then
    update public.entities set key = v_clash.key || '--old-' || left(v_clash.id::text, 8) where id = v_clash.id;
  end if;
  update public.entities set type = v_type where id = v_entity.id;
  insert into public.entities (type, key, name, merged_into_id)
  values (v_entity.type, v_entity.key, v_entity.name, v_entity.id)
  returning id into v_stub;
  update public.actions
  set undo_state = jsonb_build_object('fromType', v_entity.type, 'stubId', v_stub,
    'clash', case when v_clash.id is null then null else jsonb_build_object('id', v_clash.id, 'key', v_clash.key) end)
  where id = p_action.id;
end $$;

alter function change_control.apply_action(public.actions, uuid, public.actor_kind) rename to apply_action_before_retype;
create function change_control.apply_action(p_action public.actions, p_event_id uuid, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_action.type::text <> 'retype_entity' then
    perform change_control.apply_action_before_retype(p_action, p_event_id, p_author);
    return;
  end if;
  perform change_control.apply_retype_entity(p_action);
  update public.actions set outcome = 'applied', applied_at = now() where id = p_action.id;
end $$;

-- UNDO: the entity takes its old type back from the stub. Claim links a re-projected revision
-- attached to the stub move to the entity (the same thing). Refused when the entity changed since.
alter function change_control.undo_action(public.actions, uuid) rename to undo_action_before_retype;
create function change_control.undo_action(p_action public.actions, p_revert_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_stub uuid := (p_action.undo_state ->> 'stubId')::uuid;
  v_clash jsonb := p_action.undo_state -> 'clash';
begin
  if p_action.type::text <> 'retype_entity' then
    perform change_control.undo_action_before_retype(p_action, p_revert_event_id);
    return;
  end if;
  perform 1 from public.entities where id in (p_action.target_id, v_stub) order by id for update;
  if (select type from public.entities where id = p_action.target_id) is distinct from p_action.input ->> 'type'
     or exists (select 1 from public.entities where id = p_action.target_id and (merged_into_id is not null or retired_at is not null))
     or (select merged_into_id from public.entities where id = v_stub) is distinct from p_action.target_id then
    raise exception 'This entity changed again later. Undo that change first.';
  end if;
  insert into public.unit_entities (unit_id, entity_id, role)
  select unit_id, p_action.target_id, role from public.unit_entities where entity_id = v_stub
  on conflict (unit_id, entity_id) do nothing;
  delete from public.unit_entities where entity_id = v_stub;
  delete from public.entities where id = v_stub;
  update public.entities set type = p_action.undo_state ->> 'fromType' where id = p_action.target_id;
  if v_clash is not null and jsonb_typeof(v_clash) = 'object' then
    update public.entities set key = v_clash ->> 'key' where id = (v_clash ->> 'id')::uuid
      and not exists (select 1 from public.entities o where o.type = (select type from public.entities where id = (v_clash ->> 'id')::uuid) and o.key = v_clash ->> 'key');
  end if;
  update public.actions set outcome = 'reverted', reverted_by_event_id = p_revert_event_id where id = p_action.id;
end $$;

-- A retyped entity counts as touched by its event, so its stakeholder card and description follow
create or replace function public.event_touched_entities(p_event_id uuid)
returns jsonb
language sql
stable security definer
set search_path = ''
as $$
  with acted as (
    select a.type::text type, a.target_id, a.input from public.actions a join public.change_sets c on c.id = a.change_set_id
    where c.event_id = p_event_id and a.outcome = 'applied'
  ), touched as (
    select ue.entity_id id from acted join public.unit_entities ue on ue.unit_id = acted.target_id
    where acted.type in ('add_claim', 'revise_claim', 'retire_claim', 'merge_duplicates', 'set_epistemic_status')
    union select target_id from acted where type in ('create_entity', 'retype_entity')
    union select (input ->> 'intoEntityId')::uuid from acted where type = 'merge_entity'
  )
  select coalesce(jsonb_agg(distinct public.entity_canonical_id(t.id)), '[]')
  from touched t join public.entities e on e.id = public.entity_canonical_id(t.id)
  where e.retired_at is null
$$;

revoke execute on all functions in schema change_control from public, anon, authenticated;
