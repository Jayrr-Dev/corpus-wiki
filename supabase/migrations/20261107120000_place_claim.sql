-- =====================================================================
-- PLACE CLAIM: files a saved claim into topics.
-- Uploads save their claims first, without topics, and file them in one
-- pass after the knowledge is cleaned (lib/ai/tokenFactory/placeTopics.ts):
-- one view of the whole file, so a long file no longer gets one topic per
-- extraction batch. target = the unit; input = { domainPaths, rationale? }.
-- The paths may be created earlier in the same ChangeSet (create_domain,
-- applied in position order), and a new root still waits for approval.
-- Applying REPLACES the unit's topics; undo puts the previous ones back.
-- =====================================================================

-- CHECK: the claim exists and is live (as for revise_claim)
create or replace function change_control.check_target(p_action public.actions)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_unit public.units;
begin
  if p_action.type::text not in ('revise_claim', 'retire_claim', 'set_epistemic_status', 'merge_duplicates', 'place_claim') then
    return null;
  end if;
  select * into v_unit from public.units where id = p_action.target_id;
  if v_unit.id is null then
    return change_control.check('target', false, 'The unit does not exist.');
  end if;
  if v_unit.retired_at is not null then
    return change_control.check('target', false, 'The unit is retired.');
  end if;
  return change_control.check('target', true, null);
end $$;

-- CHECK: at least one topic, and every named topic exists and is live when the action applies
alter function change_control.check_references(public.actions) rename to check_references_before_place;
create function change_control.check_references(p_action public.actions)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_missing text;
begin
  if p_action.type::text <> 'place_claim' then
    return change_control.check_references_before_place(p_action);
  end if;
  if jsonb_array_length(coalesce(p_action.input -> 'domainPaths', '[]')) = 0 then
    return change_control.check('references', false, 'No topic to file the claim under.');
  end if;
  select string_agg(d, ', ') into v_missing
  from jsonb_array_elements_text(p_action.input -> 'domainPaths') d
  where not exists (select 1 from public.domains x where x.path = d and x.retired_at is null);
  return change_control.check('references', v_missing is null, case when v_missing is not null then 'Unknown topic: ' || v_missing end);
end $$;

-- WRITER: the claim's topics become the named ones; undo_state keeps both sets
create function change_control.apply_place_claim(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform 1 from public.units where id = p_action.target_id for update;
  select coalesce(jsonb_agg(domain_id order by domain_id), '[]') into v_before from public.unit_domains where unit_id = p_action.target_id;
  delete from public.unit_domains where unit_id = p_action.target_id;
  insert into public.unit_domains (unit_id, domain_id)
  select p_action.target_id, x.id
  from jsonb_array_elements_text(coalesce(p_action.input -> 'domainPaths', '[]')) d
  join public.domains x on x.path = d and x.retired_at is null
  on conflict do nothing;
  select coalesce(jsonb_agg(domain_id order by domain_id), '[]') into v_after from public.unit_domains where unit_id = p_action.target_id;
  update public.actions set undo_state = jsonb_build_object('before', v_before, 'after', v_after) where id = p_action.id;
end $$;

-- DISPATCH: the catalog-edits version (20261017000000) plus place_claim
create or replace function change_control.apply_action(p_action public.actions, p_event_id uuid, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_model text := (select model_version from public.change_sets where id = p_action.change_set_id);
begin
  case p_action.type::text
    when 'create_domain' then perform change_control.apply_create_domain(p_action, p_author);
    when 'create_entity' then perform change_control.apply_create_entity(p_action);
    when 'add_claim' then perform change_control.apply_add_claim(p_action, p_event_id, p_author);
    when 'revise_claim' then perform change_control.apply_revise_claim(p_action, p_event_id, p_author);
    when 'retire_claim' then perform change_control.apply_retire_claim(p_action);
    when 'set_epistemic_status' then perform change_control.apply_set_epistemic_status(p_action);
    when 'link' then perform change_control.apply_link(p_action, p_event_id);
    when 'merge_duplicates' then perform change_control.apply_merge_duplicates(p_action);
    when 'place_claim' then perform change_control.apply_place_claim(p_action);
    when 'write_line' then perform change_control.apply_write_line(p_action, p_event_id, p_author, v_model);
    when 'revise_line' then perform change_control.apply_revise_line(p_action, p_event_id, p_author, v_model);
    when 'retire_line' then perform change_control.apply_retire_line(p_action);
    when 'move_line' then perform change_control.apply_move_line(p_action);
    when 'create_page' then perform change_control.apply_create_page(p_action);
    when 'create_section' then perform change_control.apply_create_section(p_action);
    when 'rename_page', 'rename_section' then perform change_control.apply_rename(p_action);
    when 'retire_page', 'retire_section' then perform change_control.set_page_retired(p_action.type::text, p_action.target_id, true);
    when 'update_entity' then perform change_control.apply_update_entity(p_action);
    when 'retire_entity' then perform change_control.apply_retire_entity(p_action);
    when 'update_domain' then perform change_control.apply_update_domain(p_action);
    when 'retire_domain' then perform change_control.apply_retire_domain(p_action);
  end case;
  update public.actions set outcome = 'applied', applied_at = now() where id = p_action.id;
end $$;

-- UNDO BLOCKING: filing a claim later never blocks undoing the upload that added it
-- (an undone place_claim checks its own snapshot instead, below)
create or replace function change_control.unit_moved_since(p_action public.actions)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.actions later
    where later.target_id = p_action.target_id and later.outcome = 'applied'
      and later.applied_at > p_action.applied_at and later.id <> p_action.id
      and later.type::text <> 'place_claim'
      and p_action.type::text in ('add_claim', 'revise_claim', 'retire_claim', 'set_epistemic_status',
                                  'write_line', 'revise_line', 'retire_line', 'move_line',
                                  'create_page', 'rename_page', 'retire_page',
                                  'create_section', 'rename_section', 'retire_section',
                                  'update_entity', 'retire_entity', 'update_domain', 'retire_domain')
  )
$$;

-- UNDO: the claim's previous topics come back, unless its topics changed again since
alter function change_control.undo_action(public.actions, uuid) rename to undo_action_before_place;
create function change_control.undo_action(p_action public.actions, p_revert_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_action.type::text <> 'place_claim' then
    perform change_control.undo_action_before_place(p_action, p_revert_event_id);
    return;
  end if;
  perform 1 from public.units where id = p_action.target_id for update;
  if (select coalesce(jsonb_agg(domain_id order by domain_id), '[]') from public.unit_domains where unit_id = p_action.target_id)
     is distinct from coalesce(p_action.undo_state -> 'after', '[]') then
    raise exception 'This claim''s topics changed later. Undo that change first.';
  end if;
  delete from public.unit_domains where unit_id = p_action.target_id;
  insert into public.unit_domains (unit_id, domain_id)
  select p_action.target_id, (value #>> '{}')::uuid
  from jsonb_array_elements(coalesce(p_action.undo_state -> 'before', '[]'))
  where exists (select 1 from public.domains d where d.id = (value #>> '{}')::uuid)
  on conflict do nothing;
  update public.actions set outcome = 'reverted', reverted_by_event_id = p_revert_event_id where id = p_action.id;
end $$;

revoke execute on all functions in schema change_control from public, anon, authenticated;

-- WHAT THE TOPIC STEP READS: the upload's live claims that have no topic yet (from every
-- ChangeSet of the event: the upload's own and any later one), the live topic tree, and
-- the person's domain tabs (the same tabs reconciliation_input gives extraction)
create function public.upload_unplaced_claims(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unitId', u.id,
        'title', coalesce(r.title, ''),
        'content', r.content,
        'entities', coalesce((select jsonb_agg(distinct e.name) from public.unit_entities ue
          join public.entities e on e.id = ue.entity_id where ue.unit_id = u.id and ue.role <> 'mentioned'), '[]'::jsonb)
      ) order by u.created_at, u.id)
      from public.units u
      join public.revisions r on r.id = u.current_revision_id
      where u.retired_at is null
        and u.id in (select a.target_id from public.actions a join public.change_sets c on c.id = a.change_set_id
          where c.event_id = p_event_id and a.outcome = 'applied' and a.type::text in ('add_claim', 'revise_claim'))
        and not exists (select 1 from public.unit_domains ud where ud.unit_id = u.id)
    ), '[]'::jsonb),
    'domainPaths', coalesce((select jsonb_agg(d.path order by d.path) from public.domains d where d.retired_at is null), '[]'::jsonb),
    'domainTabs', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'description', t.description, 'rootPaths',
        coalesce((select jsonb_agg(d.path order by d.path) from public.domains d
          where d.id = any (t.root_ids) and d.parent_id is null and d.retired_at is null), '[]'::jsonb)))
      from public.domain_tabs t), '[]'::jsonb)
  )
$$;
revoke all on function public.upload_unplaced_claims(uuid) from public, anon, authenticated;
grant execute on function public.upload_unplaced_claims(uuid) to service_role;
