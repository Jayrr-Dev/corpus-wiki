-- =====================================================================
-- SECOND BRAIN · CATALOG EDITS (entities and domains)
-- =====================================================================
-- A person can rename and retire entities and domains, from the Entities
-- and Domains screens. Like every knowledge change they are typed
-- actions that Change control checks, applies and can undo:
--
--   update_entity   new name and aliases (type and key stay: they are the
--                   natural key the AI and earlier actions use)
--   retire_entity   the entity is no longer offered; nothing is deleted
--   update_domain   new name; its path and its whole subtree's paths follow
--   retire_domain   the domain and its subtree are no longer offered
--
-- Retired entities and domains drop out of what the model sees, so the
-- AI stops filing new knowledge under them. Units keep their links.
-- New enum values are compared as text in this file because Postgres
-- cannot use an enum value in the transaction that adds it.
-- =====================================================================


-- =====================================================================
-- SCHEMA: retired_at on entities and domains, four action types
-- =====================================================================

alter table public.entities add column retired_at timestamptz;
comment on column public.entities.retired_at is 'Set when a person retires the entity; null means current.';
alter table public.domains add column retired_at timestamptz;
comment on column public.domains.retired_at is 'Set when a person retires the domain (and its subtree); null means current.';

alter type public.action_type add value if not exists 'update_entity';
alter type public.action_type add value if not exists 'retire_entity';
alter type public.action_type add value if not exists 'update_domain';
alter type public.action_type add value if not exists 'retire_domain';


-- =====================================================================
-- CHECK: the entity or domain must exist and be current; a renamed
-- domain's new path must be free
-- =====================================================================

create function change_control.check_catalog_target(p_action public.actions)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_retired timestamptz;
  v_found boolean;
  v_new_path text;
begin
  if p_action.type::text in ('update_entity', 'retire_entity') then
    select true, retired_at into v_found, v_retired from public.entities where id = p_action.target_id;
  elsif p_action.type::text in ('update_domain', 'retire_domain') then
    select true, retired_at into v_found, v_retired from public.domains where id = p_action.target_id;
  else
    return null;
  end if;
  if v_found is null then
    return change_control.check('target', false, 'It does not exist.');
  end if;
  if v_retired is not null then
    return change_control.check('target', false, 'It is retired.');
  end if;
  if p_action.type::text = 'update_domain' then
    v_new_path := change_control.renamed_domain_path(p_action.target_id, p_action.input ->> 'name');
    if exists (select 1 from public.domains where path = v_new_path and id <> p_action.target_id) then
      return change_control.check('target', false, 'Another domain already has the path ' || v_new_path || '.');
    end if;
  end if;
  return change_control.check('target', true, null);
end $$;

-- THE PATH A DOMAIN GETS UNDER A NEW NAME (its parent's path, a slash, the name)
create function change_control.renamed_domain_path(p_domain_id uuid, p_name text)
returns text
language sql stable
set search_path = ''
as $$
  select coalesce(parent.path || '/', '') || btrim(p_name)
  from public.domains d left join public.domains parent on parent.id = d.parent_id
  where d.id = p_domain_id
$$;

-- A DOMAIN AND EVERY DOMAIN UNDER IT
create function change_control.domain_subtree(p_domain_id uuid)
returns setof uuid
language sql stable
set search_path = ''
as $$
  with recursive tree as (
    select id from public.domains where id = p_domain_id
    union all
    select d.id from public.domains d join tree on d.parent_id = tree.id
  )
  select id from tree
$$;


-- =====================================================================
-- WRITERS (each records what undo restores in undo_state)
-- =====================================================================

-- UPDATE ENTITY: new name and aliases
create function change_control.apply_update_entity(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_entity public.entities;
begin
  select * into v_entity from public.entities where id = p_action.target_id for update;
  update public.entities set
    name = btrim(p_action.input ->> 'name'),
    aliases = array(select jsonb_array_elements_text(coalesce(p_action.input -> 'aliases', '[]')))
  where id = v_entity.id;
  update public.actions set undo_state = jsonb_build_object('name', v_entity.name, 'aliases', to_jsonb(v_entity.aliases))
  where id = p_action.id;
end $$;

-- RETIRE ENTITY
create function change_control.apply_retire_entity(p_action public.actions)
returns void
language sql
set search_path = ''
as $$
  update public.entities set retired_at = now() where id = p_action.target_id;
$$;

-- UPDATE DOMAIN: new name; the domain's path and every path under it follow
create function change_control.apply_update_domain(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_domain public.domains;
begin
  select * into v_domain from public.domains where id = p_action.target_id for update;
  perform change_control.rename_domain(v_domain.id, p_action.input ->> 'name');
  update public.actions set undo_state = jsonb_build_object('name', v_domain.name) where id = p_action.id;
end $$;

-- RENAME ONE DOMAIN and rewrite the path prefix of its subtree (used by apply and undo)
create function change_control.rename_domain(p_domain_id uuid, p_name text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old_path text := (select path from public.domains where id = p_domain_id);
  v_new_path text := change_control.renamed_domain_path(p_domain_id, p_name);
begin
  update public.domains set name = btrim(p_name), path = v_new_path where id = p_domain_id;
  update public.domains
  set path = v_new_path || substr(path, length(v_old_path) + 1)
  where id in (select change_control.domain_subtree(p_domain_id)) and id <> p_domain_id;
end $$;

-- RETIRE DOMAIN: it and its current subtree; undo brings back exactly those
create function change_control.apply_retire_domain(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from public.domains
  where id in (select change_control.domain_subtree(p_action.target_id)) and retired_at is null;
  update public.domains set retired_at = now() where id = any (v_ids);
  update public.actions set undo_state = jsonb_build_object('retiredDomainIds', to_jsonb(v_ids)) where id = p_action.id;
end $$;


-- =====================================================================
-- JUDGE AND APPLY: the page-actions versions (20261015010000) plus the catalog actions
-- =====================================================================

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
    change_control.check_source_date(p_action, p_proposed_by),
    change_control.check_decision(p_action),
    change_control.check_deletion(p_action, p_proposed_by)
  ] loop
    continue when v_check is null;
    v_checks := v_checks || v_check;
    continue when (v_check ->> 'passed')::boolean or v_outcome = 'rejected';
    v_detail := v_check ->> 'detail';
    -- A failed target, line, page, reference or date check rejects; the rest ask a person
    case v_check ->> 'name'
      when 'source_tie' then v_outcome := 'exception'; v_reason := 'source_tie';
      when 'decision' then v_outcome := 'exception'; v_reason := 'decision_conflict';
      when 'deletion' then v_outcome := 'exception'; v_reason := 'deletion';
      else v_outcome := 'rejected'; v_reason := null;
    end case;
  end loop;
  return jsonb_build_object('outcome', v_outcome, 'reason', v_reason, 'detail', v_detail, 'checks', v_checks);
end $$;

-- DELETION: the AI may propose retiring knowledge, but a person confirms it
create or replace function change_control.check_deletion(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case when p_action.type::text in ('retire_claim', 'merge_duplicates', 'retire_entity', 'retire_domain') and p_proposed_by = 'ai'
    then change_control.check('deletion', false, 'The AI wants to retire knowledge.') end
$$;

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


-- =====================================================================
-- UNDO: a later change to the same entity or domain blocks undo, like units
-- =====================================================================

create or replace function change_control.unit_moved_since(p_action public.actions)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.actions later
    where later.target_id = p_action.target_id and later.outcome = 'applied'
      and later.applied_at > p_action.applied_at and later.id <> p_action.id
      and p_action.type::text in ('add_claim', 'revise_claim', 'retire_claim', 'set_epistemic_status',
                                  'write_line', 'revise_line', 'retire_line', 'move_line',
                                  'create_page', 'rename_page', 'retire_page',
                                  'create_section', 'rename_section', 'retire_section',
                                  'update_entity', 'retire_entity', 'update_domain', 'retire_domain')
  )
$$;

-- THE INVERSE OF ONE CATALOG ACTION
create function change_control.undo_catalog_action(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_state jsonb := coalesce(p_action.undo_state, '{}');
begin
  case p_action.type::text
    when 'update_entity' then
      update public.entities
      set name = v_state ->> 'name', aliases = array(select jsonb_array_elements_text(coalesce(v_state -> 'aliases', '[]')))
      where id = p_action.target_id;
    when 'retire_entity' then
      update public.entities set retired_at = null where id = p_action.target_id;
    when 'update_domain' then
      perform change_control.rename_domain(p_action.target_id, v_state ->> 'name');
    when 'retire_domain' then
      update public.domains set retired_at = null where id = any (change_control.uuid_array(v_state -> 'retiredDomainIds'));
  end case;
end $$;

create or replace function change_control.undo_action(p_action public.actions, p_revert_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_state jsonb := coalesce(p_action.undo_state, '{}');
begin
  if change_control.unit_moved_since(p_action) then
    raise exception 'A later change edited the same knowledge. Undo that change first.';
  end if;
  case
    when p_action.type::text in ('write_line', 'revise_line', 'retire_line', 'move_line') then
      perform change_control.undo_line_action(p_action);
    when p_action.type::text in ('create_page', 'rename_page', 'retire_page', 'create_section', 'rename_section', 'retire_section') then
      perform change_control.undo_page_action(p_action);
    when p_action.type::text in ('update_entity', 'retire_entity', 'update_domain', 'retire_domain') then
      perform change_control.undo_catalog_action(p_action);
    when p_action.type = 'add_claim' then
      update public.units set retired_at = now(), last_changed_at = now() where id = p_action.target_id;
    when p_action.type = 'revise_claim' then
      update public.units set current_revision_id = p_action.before_revision_id,
        epistemic_status = (v_state ->> 'epistemicStatus')::public.epistemic_status,
        valid_from = (v_state ->> 'validFrom')::timestamptz, last_changed_at = now()
      where id = p_action.target_id;
    when p_action.type = 'retire_claim' then
      update public.units set retired_at = null, valid_to = (v_state ->> 'validTo')::timestamptz, last_changed_at = now()
      where id = p_action.target_id;
    when p_action.type = 'set_epistemic_status' then
      update public.units set epistemic_status = (v_state ->> 'epistemicStatus')::public.epistemic_status, last_changed_at = now()
      where id = p_action.target_id;
    when p_action.type = 'link' then
      update public.relationships set retired_at = now() where id = (v_state ->> 'relationshipId')::uuid;
    when p_action.type = 'merge_duplicates' then
      update public.units set retired_at = null, last_changed_at = now()
      where id = any (change_control.uuid_array(v_state -> 'retiredUnitIds'));
    else
      perform change_control.undo_create(p_action);
  end case;
  update public.actions set outcome = 'reverted', reverted_by_event_id = p_revert_event_id where id = p_action.id;
end $$;


-- =====================================================================
-- WHAT THE MODEL SEES: retired entities and domains are left out
-- =====================================================================

create or replace function public.reconciliation_input(p_event_id uuid)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'source', jsonb_build_object('id', s.id, 'title', s.title, 'sourceDate', s.source_date),
    'passages', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'position', p.position, 'text', p.text, 'speakerLabel', p.speaker_label)
                       order by p.position)
      from public.passages p where p.source_id = s.id), '[]'),
    'existingUnits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unitId', u.id, 'revisionId', r.id, 'content', r.content, 'kind', u.kind,
        'epistemicStatus', u.epistemic_status, 'sourceDate', r.source_date, 'passageIds', to_jsonb(r.passage_ids)
      ) order by u.created_at)
      from public.units u join public.revisions r on r.id = u.current_revision_id
      where u.retired_at is null), '[]'),
    'domainPaths', coalesce((select jsonb_agg(d.path order by d.path) from public.domains d where d.retired_at is null), '[]'),
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object('type', e.type, 'key', e.key, 'name', e.name) order by e.type, e.key)
      from public.entities e where e.merged_into_id is null and e.retired_at is null), '[]')
  )
  from public.shift_events ev join public.sources s on s.id = ev.source_id
  where ev.id = p_event_id
$$;
