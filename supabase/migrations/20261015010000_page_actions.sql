-- =====================================================================
-- SECOND BRAIN · PAGE ACTIONS (Sam asked 2026-10-14)
-- =====================================================================
-- Pages and sections now change only through typed actions in a
-- ChangeSet, like claims and lines, so every page edit is audited on the
-- Changes screen and can be undone.
--
--   * The pipeline proposes pages from the knowledge: after an upload,
--     each entity with enough claims gets a page (one section per kind of
--     claim), and an existing entity page gets a section for a new kind.
--     The AI's proposals pass the same checks (approval by exception).
--   * A person renames a page, adds, renames or removes a section.
--   * Removing is retiring (retired_at), so undo can bring it back.
--
-- PAGE ACTION INPUTS (actions.input); target_id = the page or section
--   create_page     { title, entityId?, sections: [{ title, query }] }
--   rename_page     { title }
--   retire_page     {}
--   create_section  { pageId, title, query }
--   rename_section  { title }
--   retire_section  {}
-- An applied create records the new page or section in target_id.
-- =====================================================================


-- =====================================================================
-- ENUMS
-- =====================================================================

alter type public.action_type add value if not exists 'create_page';
alter type public.action_type add value if not exists 'rename_page';
alter type public.action_type add value if not exists 'retire_page';
alter type public.action_type add value if not exists 'create_section';
alter type public.action_type add value if not exists 'rename_section';
alter type public.action_type add value if not exists 'retire_section';


-- =====================================================================
-- COLUMNS: a removed page or section is retired, not deleted
-- =====================================================================

alter table public.pages add column retired_at timestamptz;
alter table public.sections add column retired_at timestamptz;
comment on column public.pages.retired_at is 'Set when the page is removed; undo clears it. Null = shown.';
comment on column public.sections.retired_at is 'Set when the section is removed; undo clears it. Null = shown.';


-- =====================================================================
-- HELPERS
-- =====================================================================

-- "Project Alpha!" -> "project-alpha"; -2, -3... when the slug is taken (retired pages keep theirs)
create function change_control.unique_page_slug(p_title text)
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_base text := coalesce(nullif(trim(both '-' from regexp_replace(lower(p_title), '[^a-z0-9]+', '-', 'g')), ''), 'page');
  v_slug text := v_base;
  v_n integer := 2;
begin
  while exists (select 1 from public.pages where slug = v_slug) loop
    v_slug := v_base || '-' || v_n;
    v_n := v_n + 1;
  end loop;
  return v_slug;
end $$;

-- ONE NEW GENERATED SECTION at the end of its page (built later by the living page)
create function change_control.insert_section(p_page_id uuid, p_title text, p_query jsonb)
returns uuid
language sql
set search_path = ''
as $$
  insert into public.sections (page_id, position, title, mode, query, status)
  values (p_page_id, coalesce((select max(position) + 1 from public.sections where page_id = p_page_id), 0),
          trim(p_title), 'generated', p_query, 'stale')
  returning id
$$;


-- =====================================================================
-- CHECK: the page or section exists and is shown; titles are not empty;
-- the AI never proposes a second page for the same entity
-- =====================================================================

create function change_control.check_page(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_type text := p_action.type::text;
  v_title text := trim(coalesce(p_action.input ->> 'title', ''));
  v_entity_id uuid := (p_action.input ->> 'entityId')::uuid;
  v_page_id uuid;
begin
  if v_type not in ('create_page', 'rename_page', 'retire_page', 'create_section', 'rename_section', 'retire_section') then
    return null;
  end if;
  if v_type in ('create_page', 'rename_page', 'create_section', 'rename_section') and v_title = '' then
    return change_control.check('page', false, 'A title cannot be empty.');
  end if;
  if v_type = 'create_page' then
    if p_proposed_by = 'ai' and exists (select 1 from public.pages where entity_id = v_entity_id and retired_at is null) then
      return change_control.check('page', false, 'The entity already has a page.');
    end if;
    return change_control.check('page', true, null);
  end if;
  -- Every other action names a page: the target, or the new section's page
  v_page_id := case
    when v_type = 'create_section' then (p_action.input ->> 'pageId')::uuid
    when v_type like '%_page' then p_action.target_id
    else (select page_id from public.sections where id = p_action.target_id and retired_at is null)
  end;
  if not exists (select 1 from public.pages where id = v_page_id and retired_at is null) then
    return change_control.check('page', false, 'The page does not exist or was removed.');
  end if;
  return change_control.check('page', true, null);
end $$;


-- =====================================================================
-- WRITERS
-- =====================================================================

-- CREATE PAGE: the page and its first sections; target_id = the new page
create function change_control.apply_create_page(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_title text := trim(p_action.input ->> 'title');
  v_page_id uuid;
  v_section jsonb;
begin
  insert into public.pages (title, slug, entity_id)
  values (v_title, change_control.unique_page_slug(v_title), (p_action.input ->> 'entityId')::uuid)
  returning id into v_page_id;
  for v_section in select value from jsonb_array_elements(coalesce(p_action.input -> 'sections', '[]')) loop
    perform change_control.insert_section(v_page_id, v_section ->> 'title', v_section -> 'query');
  end loop;
  update public.actions set target_id = v_page_id, undo_state = '{}' where id = p_action.id;
end $$;

-- RENAME PAGE OR SECTION: the old title goes in undo_state (the slug stays, so links keep working)
create function change_control.apply_rename(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_title text := trim(p_action.input ->> 'title');
  v_old text;
begin
  if p_action.type::text = 'rename_page' then
    select title into v_old from public.pages where id = p_action.target_id for update;
    update public.pages set title = v_title where id = p_action.target_id;
  else
    select title into v_old from public.sections where id = p_action.target_id for update;
    update public.sections set title = v_title where id = p_action.target_id;
  end if;
  update public.actions set undo_state = jsonb_build_object('title', v_old) where id = p_action.id;
end $$;

-- CREATE SECTION: at the end of its page; target_id = the new section
create function change_control.apply_create_section(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_section_id uuid := change_control.insert_section(
    (p_action.input ->> 'pageId')::uuid, p_action.input ->> 'title', p_action.input -> 'query');
begin
  update public.actions set target_id = v_section_id, undo_state = '{}' where id = p_action.id;
end $$;

-- RETIRE OR UNRETIRE A PAGE OR SECTION (remove, and the undo of a create or a remove)
create function change_control.set_page_retired(p_type text, p_target_id uuid, p_retired boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_type like '%_page' then
    update public.pages set retired_at = case when p_retired then now() end where id = p_target_id;
  else
    update public.sections set retired_at = case when p_retired then now() end where id = p_target_id;
  end if;
end $$;


-- =====================================================================
-- CHANGE CONTROL: the shared functions, now aware of page actions
-- (bodies copied from 20261015000000_lines_as_rows.sql plus the new cases)
-- =====================================================================

-- ALL CHECKS FOR ONE ACTION, folded into one verdict (adds the page check)
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

-- APPLY ONE ACTION (already judged) and mark it applied
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
  end case;
  update public.actions set outcome = 'applied', applied_at = now() where id = p_action.id;
end $$;

-- A later change touched this action's unit, line, page or section? (undo would lose it)
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
                                  'create_section', 'rename_section', 'retire_section')
  )
$$;

-- THE INVERSE OF ONE APPLIED PAGE ACTION
create function change_control.undo_page_action(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_action.type::text
    when 'create_page', 'create_section' then
      perform change_control.set_page_retired(p_action.type::text, p_action.target_id, true);
    when 'retire_page', 'retire_section' then
      perform change_control.set_page_retired(p_action.type::text, p_action.target_id, false);
    when 'rename_page' then
      update public.pages set title = p_action.undo_state ->> 'title' where id = p_action.target_id;
    when 'rename_section' then
      update public.sections set title = p_action.undo_state ->> 'title' where id = p_action.target_id;
  end case;
end $$;

-- THE INVERSE OF ONE APPLIED ACTION (line and page actions handled by their own functions)
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
-- LIVING PAGE: retired pages and sections are never rebuilt
-- =====================================================================

-- AFFECTED SECTIONS: as before (lines_as_rows), skipping retired sections and pages
create or replace function public.list_affected_sections(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with touched as (
    select touched_id from public.living_page_event_units(p_event_id) as t(touched_id)
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('sectionId', s.id, 'pageId', s.page_id) order by s.page_id, s.position),
    '[]'::jsonb
  )
  from public.sections s
  join public.pages p on p.id = s.page_id
  where s.mode = 'generated' and s.retired_at is null and p.retired_at is null
    and (
      exists (select 1 from public.stale_lines sl where sl.section_id = s.id)
      or exists (
        select 1 from public.section_inputs si
        where si.section_id = s.id and si.unit_id in (select touched_id from touched)
      )
      or exists (
        select 1 from public.living_page_query_units(s.query) as q(unit_id)
        where q.unit_id in (select touched_id from touched)
      )
    );
$$;

-- PAGE SECTIONS: every shown generated section of one page. Returns [{ sectionId, pageId }]
create or replace function public.list_page_sections(p_page_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('sectionId', s.id, 'pageId', s.page_id) order by s.position),
    '[]'::jsonb
  )
  from public.sections s
  where s.page_id = p_page_id and s.mode = 'generated' and s.retired_at is null;
$$;

-- PAGE CANDIDATES: each entity an event's claims are about, with what a page for it would need.
-- Returns [{ entityId, type, key, name, claimCount, kinds: [..], page: { pageId, coveredKinds, coversAll } | null }]
-- kinds = kinds of the entity's current claims; coveredKinds = kinds the page's entity sections show
-- (coversAll when one of them shows every kind). The app decides what to propose (lib/living-page/proposePages.ts).
create function public.page_candidates(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with touched_entities as (
    select distinct ue.entity_id
    from public.living_page_event_units(p_event_id) as t(unit_id)
    join public.unit_entities ue on ue.unit_id = t.unit_id
  ),
  entity_claims as (
    select e.id, e.type, e.key, e.name, count(*) as claim_count, jsonb_agg(distinct u.kind) as kinds
    from touched_entities te
    join public.entities e on e.id = te.entity_id and e.merged_into_id is null
    join public.unit_entities ue on ue.entity_id = e.id
    join public.units u on u.id = ue.unit_id and u.retired_at is null
    group by e.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'entityId', ec.id, 'type', ec.type, 'key', ec.key, 'name', ec.name,
    'claimCount', ec.claim_count, 'kinds', ec.kinds,
    'page', (
      select jsonb_build_object(
        'pageId', p.id,
        'coversAll', coalesce(bool_or(s.id is not null and coalesce(jsonb_array_length(s.query -> 'kinds'), 0) = 0), false),
        'coveredKinds', coalesce(jsonb_agg(k.kind) filter (where k.kind is not null), '[]'))
      from public.pages p
      left join public.sections s on s.page_id = p.id and s.retired_at is null
        and s.query -> 'entity' ->> 'type' = ec.type and s.query -> 'entity' ->> 'key' = ec.key
      left join lateral jsonb_array_elements_text(coalesce(s.query -> 'kinds', '[]')) as k(kind) on true
      where p.entity_id = ec.id and p.retired_at is null
      group by p.id
      order by p.id
      limit 1)
  ) order by ec.name), '[]'::jsonb)
  from entity_claims ec;
$$;


-- =====================================================================
-- ACCESS: only server code (secret key = service_role) may call these
-- =====================================================================

revoke execute on all functions in schema change_control from public, anon, authenticated;
revoke execute on function public.page_candidates(uuid) from public, anon, authenticated;
grant execute on function public.page_candidates(uuid) to service_role;
