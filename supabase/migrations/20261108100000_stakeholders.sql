-- =====================================================================
-- STAKEHOLDERS: entity cards, entity merges, housekeeping retires
-- =====================================================================
-- 1. MERGED ENTITIES RESOLVE. A merged entity keeps its row (claims'
--    knowledge context names it by type and key, and revisions never
--    change), and every lookup by type and key follows merged_into_id to
--    the entity that stayed: validation, the unit links projection and
--    section queries.
-- 2. MERGE_ENTITY. target = the duplicate; input = { intoEntityId,
--    reason, autoMerge? }. Its claim links move to the entity that stays,
--    its name becomes an alias there. A duplicate that owns pages or
--    topic roots is not merged (the detector picks it as the one that
--    stays instead). Undo puts every link back.
-- 3. HOUSEKEEPING RETIRES. The AI may retire an entity nothing uses (no
--    live claim names it, no page or topic root belongs to it) without a
--    person confirming: no knowledge is lost and it can be undone. A
--    later create of the same type and key brings it back.
-- 4. ENTITY PROFILES. Derived text like entities.description (written
--    straight by the server, not through Change control): whether the
--    entity is a stakeholder, its kind (open vocabulary, from the AI),
--    how it relates to the work, key facts, functions and contacts. A
--    person's contacts and the hidden flag are never overwritten.
-- 5. OUR ORGANIZATION. An optional workspace setting the cards anchor
--    "how they relate to us" on; without it, they relate to the work.
-- New enum values are compared as text: 'merge_entity' was added in
-- 20261108090000, in its own transaction.
-- =====================================================================


-- =====================================================================
-- 1. RESOLUTION
-- =====================================================================

-- THE ENTITY THAT STAYED: follows merged_into_id (bounded, so a bad cycle cannot hang)
create function public.entity_canonical_id(p_id uuid)
returns uuid language sql stable set search_path = '' as $$
  with recursive chain(id, next, depth) as (
    select e.id, e.merged_into_id, 0 from public.entities e where e.id = p_id
    union all
    select e.id, e.merged_into_id, c.depth + 1 from public.entities e join chain c on e.id = c.next where c.depth < 20
  )
  select id from chain where next is null limit 1
$$;

-- THE ENTITY A TYPE AND KEY NAME TODAY (null when none)
create function public.entity_id_for(p_type text, p_key text)
returns uuid language sql stable set search_path = '' as $$
  select public.entity_canonical_id(e.id) from public.entities e where e.type = p_type and e.key = p_key
$$;

-- ANCHORS CONTENT: a live page is about it, or a live topic root is its context
create function public.entity_anchors_content(p_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.pages p where (p.entity_id = p_id or p.context_entity_id = p_id) and p.retired_at is null)
    or exists (select 1 from public.domains d where d.context_entity_id = p_id and d.retired_at is null)
$$;

-- IN USE: a live claim links it or scopes to it, or a live page or topic root belongs to it
create function public.entity_in_use(p_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.unit_entities ue join public.units u on u.id = ue.unit_id
                 where ue.entity_id = p_id and u.retired_at is null)
    or exists (select 1 from public.units u join public.revisions r on r.id = u.current_revision_id
               cross join lateral jsonb_array_elements(coalesce(r.knowledge_context -> 'applicability' -> 'entities', '[]')) s
               where u.retired_at is null and public.entity_id_for(s ->> 'type', s ->> 'key') = p_id)
    or public.entity_anchors_content(p_id)
$$;

-- VALIDATION: the 20261105180000 checks, with entities resolved through merges
create or replace function change_control.validate_knowledge_context_before_roles(c jsonb) returns void language plpgsql set search_path='' as $$
declare e jsonb; scope jsonb:=c->'applicability'; resolved uuid;
begin
 if c is null or jsonb_typeof(c)<>'object' or jsonb_typeof(c->'entities') is distinct from 'array'
 or jsonb_typeof(scope) is distinct from 'object' or coalesce(scope->>'status','') not in ('unspecified','general','scoped')
 or jsonb_typeof(scope->'entities') is distinct from 'array'
 or not (scope ? 'conditions') or jsonb_typeof(scope->'conditions') not in ('string','null') then raise exception 'Invalid knowledge context'; end if;
 if scope->>'status'<>'scoped' and (jsonb_array_length(scope->'entities')>0 or nullif(btrim(scope->>'conditions'),'') is not null) then raise exception 'Only scoped context may have applicability constraints'; end if;
 if scope->>'status'='scoped' and jsonb_array_length(scope->'entities')=0 and nullif(btrim(scope->>'conditions'),'') is null then raise exception 'Scoped context needs an entity or condition'; end if;
 for e in select value from jsonb_array_elements(c->'entities') loop
  if coalesce(e->>'role','') not in ('subject','object','mentioned') then raise exception 'Invalid entity role'; end if;
 end loop;
 for e in select value from jsonb_array_elements((c->'entities')||(scope->'entities')) loop
  resolved:=case when coalesce(btrim(e->>'type'),'')<>'' and coalesce(btrim(e->>'key'),'')<>'' then public.entity_id_for(e->>'type',e->>'key') end;
  if resolved is null or not exists(select 1 from public.entities x where x.id=resolved and x.retired_at is null) then
   raise exception 'Unknown or inactive entity in knowledge context';
  end if;
 end loop;
end $$;

-- PROJECTION: the 20261105190000 version; a merged entity's links land on the one that stayed,
-- and when a claim names both, the stronger role wins (subject, then object, then mentioned)
create or replace function change_control.project_knowledge_context(p_unit uuid) returns uuid[] language plpgsql set search_path='' as $$
declare c jsonb; section_id uuid; old_sections uuid[]; affected uuid[]:='{}';
begin
 select r.knowledge_context into c from public.units u join public.revisions r on r.id=u.current_revision_id where u.id=p_unit;
 if c is null then c:=jsonb_build_object('entities','[]'::jsonb); end if;
 select array_agg(s.id) into old_sections from public.sections s where s.mode='generated' and (
  p_unit in (select public.living_page_query_units(s.query))
  or exists(select 1 from public.section_inputs si where si.section_id=s.id and si.unit_id=p_unit)
  or exists(select 1 from public.revisions r cross join lateral jsonb_array_elements(coalesce(r.knowledge_context->'applicability'->'entities','[]'::jsonb)) e
    where r.unit_id=p_unit and e->>'type'=s.query->'entity'->>'type' and e->>'key'=s.query->'entity'->>'key')
 );
 delete from public.unit_entities where unit_id=p_unit;
 insert into public.unit_entities(unit_id,entity_id,role)
 select distinct on (canonical) p_unit,canonical,role from (
  select public.entity_canonical_id(e.id) canonical,(x->>'role')::public.entity_role role,
   case x->>'role' when 'subject' then 0 when 'object' then 1 else 2 end strength
  from jsonb_array_elements(c->'entities') x join public.entities e on e.type=x->>'type' and e.key=x->>'key'
 ) links order by canonical,strength
 on conflict do nothing;
 for section_id in select s.id from public.sections s where s.mode='generated' and
 (s.id=any(coalesce(old_sections,'{}'::uuid[])) or p_unit in (select public.living_page_query_units(s.query))) loop
  perform public.mark_section_stale(section_id);
  affected:=array_append(affected,section_id);
 end loop;
 return affected;
end $$;

-- SECTION QUERIES: the 20261105190000 version, with the queried entity resolved through merges
create or replace function public.living_page_query_units(p_query jsonb)
returns setof uuid language sql stable set search_path='' as $$
 select u.id from public.units u join public.revisions r on r.id=u.current_revision_id
 where p_query is not null and u.retired_at is null
 and (jsonb_typeof(p_query->'unitIds') is distinct from 'array' or u.id::text in (select jsonb_array_elements_text(p_query->'unitIds')))
 and (jsonb_typeof(p_query->'entity') is distinct from 'object' or exists (
  select 1 from public.unit_entities ue
  where ue.unit_id=u.id and ue.entity_id=public.entity_id_for(p_query->'entity'->>'type',p_query->'entity'->>'key')
  and ue.role::text in (select jsonb_array_elements_text(coalesce(p_query->'entityRoles','["subject","object"]'::jsonb)))
 ) or (r.knowledge_context->'applicability'->>'status'='scoped' and exists (
  select 1 from jsonb_array_elements(r.knowledge_context->'applicability'->'entities') e
  where public.entity_id_for(e->>'type',e->>'key')=public.entity_id_for(p_query->'entity'->>'type',p_query->'entity'->>'key')
 )))
 and (jsonb_typeof(p_query->'domainPaths') is distinct from 'array' or jsonb_array_length(p_query->'domainPaths')=0 or exists (
  select 1 from public.unit_domains ud join public.domains d on d.id=ud.domain_id
  cross join jsonb_array_elements_text(p_query->'domainPaths') wanted(path)
  where ud.unit_id=u.id and (d.path=wanted.path or starts_with(d.path,wanted.path||'/'))
 ))
 and (jsonb_typeof(p_query->'kinds') is distinct from 'array' or jsonb_array_length(p_query->'kinds')=0 or u.kind::text in (select jsonb_array_elements_text(p_query->'kinds')))
$$;

-- CREATE ENTITY: as before, and an existing retired entity of the same type and key comes back
-- when housekeeping retired it while nothing used it (new knowledge uses it again)
create or replace function change_control.apply_create_entity(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_created boolean;
  v_revived boolean := false;
begin
  insert into public.entities (type, key, name, aliases)
  values (
    p_action.input ->> 'type', p_action.input ->> 'key', p_action.input ->> 'name',
    array(select jsonb_array_elements_text(coalesce(p_action.input -> 'aliases', '[]')))
  )
  on conflict (type, key) do nothing
  returning id into v_id;
  v_created := v_id is not null;
  if not v_created then
    select id into v_id from public.entities where type = p_action.input ->> 'type' and key = p_action.input ->> 'key';
    -- Only a housekeeping retire is undone this way; an entity a person retired stays retired
    update public.entities e set retired_at = null
    where e.id = public.entity_canonical_id(v_id) and e.retired_at is not null
      and (select a.input ->> 'housekeeping' from public.actions a
           where a.target_id = e.id and a.type::text = 'retire_entity' and a.outcome = 'applied'
           order by a.applied_at desc limit 1) = 'true';
    v_revived := found;
  end if;
  update public.actions
  set target_id = v_id, undo_state = jsonb_build_object('created', v_created, 'revived', v_revived)
  where id = p_action.id;
end $$;


-- =====================================================================
-- 2. MERGE ENTITY
-- =====================================================================

-- CHECK: both live and different, and the duplicate anchors no pages or topic roots
alter function change_control.check_catalog_target(public.actions) rename to check_catalog_target_before_merge;
create function change_control.check_catalog_target(p_action public.actions)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_from public.entities;
  v_into public.entities;
begin
  if p_action.type::text <> 'merge_entity' then
    return change_control.check_catalog_target_before_merge(p_action);
  end if;
  select * into v_from from public.entities where id = p_action.target_id;
  select * into v_into from public.entities where id = (p_action.input ->> 'intoEntityId')::uuid;
  if v_from.id is null or v_into.id is null then
    return change_control.check('target', false, 'An entity to merge does not exist.');
  end if;
  if v_from.id = v_into.id then
    return change_control.check('target', false, 'An entity cannot merge into itself.');
  end if;
  if v_from.retired_at is not null or v_into.retired_at is not null or v_from.merged_into_id is not null or v_into.merged_into_id is not null then
    return change_control.check('target', false, 'An entity to merge is retired or already merged.');
  end if;
  if public.entity_anchors_content(v_from.id) then
    return change_control.check('target', false, 'The duplicate has its own pages or topics; merge the other way.');
  end if;
  return change_control.check('target', true, null);
end $$;

-- WRITER: the duplicate's links move to the entity that stays (the stronger role wins where both
-- link a claim), its name and aliases become aliases there, and it points at it from now on
create function change_control.apply_merge_entity(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_from public.entities;
  v_into public.entities;
  v_links jsonb;
  v_section uuid;
begin
  select * into v_from from public.entities where id = p_action.target_id for update;
  select * into v_into from public.entities where id = (p_action.input ->> 'intoEntityId')::uuid for update;
  -- Each moved link, with the role the entity that stays had on that claim before (null: none)
  select coalesce(jsonb_agg(jsonb_build_object('unitId', f.unit_id, 'role', f.role, 'intoRole', i.role)), '[]')
  into v_links
  from public.unit_entities f
  left join public.unit_entities i on i.unit_id = f.unit_id and i.entity_id = v_into.id
  where f.entity_id = v_from.id;
  insert into public.unit_entities (unit_id, entity_id, role)
  select unit_id, v_into.id, role from public.unit_entities where entity_id = v_from.id
  on conflict (unit_id, entity_id) do update set role = case
    when public.unit_entities.role = 'subject' or excluded.role = 'subject' then 'subject'::public.entity_role
    when public.unit_entities.role = 'object' or excluded.role = 'object' then 'object'::public.entity_role
    else 'mentioned'::public.entity_role end;
  delete from public.unit_entities where entity_id = v_from.id;
  update public.entities set aliases = array(
    select distinct a from unnest(v_into.aliases || v_from.name || v_from.aliases) a
    where lower(btrim(a)) <> lower(btrim(v_into.name)) and btrim(a) <> '' order by a)
  where id = v_into.id;
  update public.entities set merged_into_id = v_into.id where id = v_from.id;
  update public.actions set undo_state = jsonb_build_object('links', v_links, 'intoAliases', to_jsonb(v_into.aliases)) where id = p_action.id;
  -- Sections about the entity that stays now see the moved claims
  for v_section in select s.id from public.sections s
    where s.mode = 'generated' and s.retired_at is null and jsonb_typeof(s.query -> 'entity') = 'object'
      and public.entity_id_for(s.query -> 'entity' ->> 'type', s.query -> 'entity' ->> 'key') = v_into.id loop
    perform public.mark_section_stale(v_section);
  end loop;
end $$;

-- DISPATCH: the place_claim version (20261107120000) plus merge_entity
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
    when 'merge_entity' then perform change_control.apply_merge_entity(p_action);
    when 'update_domain' then perform change_control.apply_update_domain(p_action);
    when 'retire_domain' then perform change_control.apply_retire_domain(p_action);
  end case;
  update public.actions set outcome = 'applied', applied_at = now() where id = p_action.id;
end $$;

-- UNDO: the duplicate gets its links and name back, unless either entity changed again since
alter function change_control.undo_action(public.actions, uuid) rename to undo_action_before_entity_merge;
create function change_control.undo_action(p_action public.actions, p_revert_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_into uuid := (p_action.input ->> 'intoEntityId')::uuid;
  v_link jsonb;
begin
  if p_action.type::text <> 'merge_entity' then
    perform change_control.undo_action_before_entity_merge(p_action, p_revert_event_id);
    return;
  end if;
  perform 1 from public.entities where id in (p_action.target_id, v_into) order by id for update;
  if (select merged_into_id from public.entities where id = p_action.target_id) is distinct from v_into
     or exists (select 1 from public.entities where id = v_into and (merged_into_id is not null or retired_at is not null)) then
    raise exception 'One of these entities changed again later. Undo that change first.';
  end if;
  update public.entities set merged_into_id = null where id = p_action.target_id;
  update public.entities set aliases = array(select jsonb_array_elements_text(coalesce(p_action.undo_state -> 'intoAliases', '[]')))
  where id = v_into;
  for v_link in select value from jsonb_array_elements(coalesce(p_action.undo_state -> 'links', '[]')) loop
    if v_link ->> 'intoRole' is null then
      delete from public.unit_entities where unit_id = (v_link ->> 'unitId')::uuid and entity_id = v_into;
    else
      update public.unit_entities set role = (v_link ->> 'intoRole')::public.entity_role
      where unit_id = (v_link ->> 'unitId')::uuid and entity_id = v_into;
    end if;
    insert into public.unit_entities (unit_id, entity_id, role)
    values ((v_link ->> 'unitId')::uuid, p_action.target_id, (v_link ->> 'role')::public.entity_role)
    on conflict (unit_id, entity_id) do nothing;
  end loop;
  update public.actions set outcome = 'reverted', reverted_by_event_id = p_revert_event_id where id = p_action.id;
end $$;


-- =====================================================================
-- 3. HOUSEKEEPING: the AI may retire an unused entity and merge sure duplicates
-- =====================================================================

-- DELETION: the 20261103000000 rules, plus: an AI retire of an entity nothing uses passes,
-- and so does an AI entity merge the judge was sure of (both undoable, no knowledge lost)
create or replace function change_control.check_deletion(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language sql stable
set search_path = ''
as $$
  select case
    when p_action.type::text = 'merge_duplicates' and p_proposed_by = 'ai' and (p_action.input ->> 'autoMerge') = 'true' then null
    when p_action.type::text = 'retire_entity' and p_proposed_by = 'ai' and (p_action.input ->> 'housekeeping') = 'true'
      and not public.entity_in_use(p_action.target_id) then null
    when p_action.type::text = 'merge_entity' and p_proposed_by = 'ai' and (p_action.input ->> 'autoMerge') = 'true' then null
    when p_action.type::text in ('retire_claim', 'merge_duplicates', 'retire_entity', 'retire_domain', 'merge_entity') and p_proposed_by = 'ai'
      then change_control.check('deletion', false, 'The AI wants to retire knowledge.')
  end
$$;

revoke execute on all functions in schema change_control from public, anon, authenticated;

-- WHAT THE CLEANUP STEP READS: every live entity with how much uses it
create function public.entity_cleanup_input()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'type', e.type, 'key', e.key, 'name', e.name, 'aliases', to_jsonb(e.aliases),
    'description', e.description,
    'claims', (select count(*) from public.unit_entities ue join public.units u on u.id = ue.unit_id
               where ue.entity_id = e.id and u.retired_at is null),
    'anchored', public.entity_anchors_content(e.id),
    'inUse', public.entity_in_use(e.id)
  ) order by e.name, e.id), '[]')
  from public.entities e where e.retired_at is null and e.merged_into_id is null
$$;
revoke all on function public.entity_cleanup_input() from public, anon, authenticated;
grant execute on function public.entity_cleanup_input() to service_role;


-- =====================================================================
-- 5. OUR ORGANIZATION (optional)
-- =====================================================================

alter table public.workspace_settings add column our_entity_id uuid references public.entities (id) on delete set null;

create or replace function public.get_workspace_settings()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'aiModel', (select s.ai_model from public.workspace_settings s where s.id),
    'autoUpdateStale', coalesce((select s.auto_update_stale from public.workspace_settings s where s.id), true),
    'allowExternalKnowledge', coalesce((select s.allow_external_knowledge from public.workspace_settings s where s.id), false),
    'ourEntityId', (select s.our_entity_id from public.workspace_settings s where s.id)
  );
$$;

create function public.set_our_entity(p_entity_id uuid)
returns jsonb
language sql
set search_path = ''
as $$
  insert into public.workspace_settings (id, our_entity_id, updated_at)
  values (true, p_entity_id, now())
  on conflict (id) do update set our_entity_id = excluded.our_entity_id, updated_at = excluded.updated_at;
  select public.get_workspace_settings();
$$;
revoke execute on function public.set_our_entity(uuid) from public, anon, authenticated;
grant execute on function public.set_our_entity(uuid) to service_role;

-- =====================================================================
-- 4. ENTITY PROFILES
-- =====================================================================

create table public.entity_profiles (
  entity_id uuid primary key references public.entities (id) on delete cascade,
  is_stakeholder boolean not null default false,
  kind text,                                   -- open vocabulary from the AI: company, regulator, role, country...
  relation text,                               -- one line: how it relates to our organization or the work
  key_facts jsonb not null default '[]',       -- [{ label, value, unitIds }]
  functions jsonb not null default '[]',       -- [{ text, unitIds }]
  contacts jsonb not null default '[]',        -- from sources: [{ kind, value, label, unitIds }]
  person_contacts jsonb not null default '[]', -- added by a person: [{ kind, value, label }]; never overwritten
  hidden boolean not null default false,       -- a person took it off the Stakeholders page
  input_hash text,                             -- the evidence it was written from; unchanged evidence is skipped
  generated_at timestamptz,
  model text,
  updated_at timestamptz not null default now()
);
comment on table public.entity_profiles is 'Stakeholder card for an entity: derived from the claims about it, like entities.description.';
create index entity_profiles_stakeholder_idx on public.entity_profiles (is_stakeholder, kind);
alter table public.entity_profiles enable row level security;
grant select on public.entity_profiles to authenticated;
grant all on public.entity_profiles to service_role;
create policy entity_profiles_read on public.entity_profiles for select to authenticated using (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = 'entity_profiles') then
    alter publication supabase_realtime add table public.entity_profiles;
  end if;
end $$;

-- EVIDENCE FOR CARDS: per entity, its live claims (subjects first, newest first), a few cited
-- passages with their source, and the live entities named in the same claims
create function public.entity_profile_evidence(p_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'entityId', e.id, 'type', e.type, 'name', e.name, 'aliases', to_jsonb(e.aliases), 'description', e.description,
    'claims', coalesce((
      select jsonb_agg(c order by c ->> 'rank', c ->> 'changed' desc) from (
        select jsonb_build_object('unitId', u.id, 'revisionId', r.id, 'title', coalesce(r.title, ''), 'content', r.content,
          'kind', u.kind, 'role', ue.role, 'passageIds', to_jsonb(r.passage_ids),
          'rank', case ue.role when 'subject' then 0 when 'object' then 1 else 2 end, 'changed', u.last_changed_at) c
        from public.unit_entities ue join public.units u on u.id = ue.unit_id join public.revisions r on r.id = u.current_revision_id
        where ue.entity_id = e.id and u.retired_at is null
        order by case ue.role when 'subject' then 0 when 'object' then 1 else 2 end, u.last_changed_at desc
        limit 40) picked), '[]'),
    'related', coalesce((
      select jsonb_agg(jsonb_build_object('entityId', o.id, 'name', o.name, 'type', o.type, 'shared', o.shared) order by o.shared desc, o.name)
      from (select x.id, x.name, x.type, count(*) shared
            from public.unit_entities mine join public.units u on u.id = mine.unit_id and u.retired_at is null
            join public.unit_entities theirs on theirs.unit_id = mine.unit_id and theirs.entity_id <> e.id
            join public.entities x on x.id = theirs.entity_id and x.retired_at is null and x.merged_into_id is null
            where mine.entity_id = e.id group by x.id order by count(*) desc, x.name limit 8) o), '[]')
  )), '[]')
  from public.entities e where e.id = any (p_ids) and e.retired_at is null and e.merged_into_id is null
$$;
revoke all on function public.entity_profile_evidence(uuid[]) from public, anon, authenticated;
grant execute on function public.entity_profile_evidence(uuid[]) to service_role;

-- WHAT AN UPLOAD TOUCHED: the live entities linked to claims its ChangeSets added, revised,
-- retired or merged, the entities it created, and those it merged duplicates into
create function public.event_touched_entities(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with acted as (
    select a.type::text type, a.target_id, a.input from public.actions a join public.change_sets c on c.id = a.change_set_id
    where c.event_id = p_event_id and a.outcome = 'applied'
  ), touched as (
    select ue.entity_id id from acted join public.unit_entities ue on ue.unit_id = acted.target_id
    where acted.type in ('add_claim', 'revise_claim', 'retire_claim', 'merge_duplicates', 'set_epistemic_status')
    union select target_id from acted where type = 'create_entity'
    union select (input ->> 'intoEntityId')::uuid from acted where type = 'merge_entity'
  )
  select coalesce(jsonb_agg(distinct public.entity_canonical_id(t.id)), '[]')
  from touched t join public.entities e on e.id = public.entity_canonical_id(t.id)
  where e.retired_at is null
$$;
revoke all on function public.event_touched_entities(uuid) from public, anon, authenticated;
grant execute on function public.event_touched_entities(uuid) to service_role;

-- THE STAKEHOLDERS PAGE: every live stakeholder card with live counts, and whether its claims
-- changed after the card was written (stale)
create function public.stakeholder_cards()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'entityId', e.id, 'name', e.name, 'type', e.type, 'aliases', to_jsonb(e.aliases), 'description', e.description,
    'kind', p.kind, 'relation', p.relation, 'keyFacts', p.key_facts, 'functions', p.functions,
    'contacts', p.contacts, 'personContacts', p.person_contacts, 'hidden', p.hidden, 'generatedAt', p.generated_at,
    'claimCount', stats.claims, 'sourceCount', stats.sources, 'lastChangedAt', stats.changed,
    'stale', stats.changed is not null and p.generated_at is not null and stats.changed > p.generated_at,
    'isOurs', e.id = (select s.our_entity_id from public.workspace_settings s where s.id)
  ) order by stats.claims desc, e.name), '[]')
  from public.entity_profiles p
  join public.entities e on e.id = p.entity_id and e.retired_at is null and e.merged_into_id is null
  cross join lateral (
    select count(distinct u.id) claims, max(u.last_changed_at) changed,
      (select count(distinct ps.source_id) from public.passages ps where ps.id = any (array(
        select unnest(r.passage_ids) from public.unit_entities ue2 join public.units u2 on u2.id = ue2.unit_id and u2.retired_at is null
        join public.revisions r on r.id = u2.current_revision_id where ue2.entity_id = e.id))) sources
    from public.unit_entities ue join public.units u on u.id = ue.unit_id and u.retired_at is null
    where ue.entity_id = e.id
  ) stats
  where p.is_stakeholder
$$;
grant execute on function public.stakeholder_cards() to authenticated, service_role;


-- ONE STAKEHOLDER'S SURROUNDINGS: the other stakeholders named in its claims, and its sources
create function public.stakeholder_detail(p_entity_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'related', coalesce((
      select jsonb_agg(jsonb_build_object('entityId', o.id, 'name', o.name, 'kind', o.kind, 'shared', o.shared) order by o.shared desc, o.name)
      from (select x.id, x.name, coalesce(p.kind, x.type) kind, count(distinct mine.unit_id) shared
            from public.unit_entities mine join public.units u on u.id = mine.unit_id and u.retired_at is null
            join public.unit_entities theirs on theirs.unit_id = mine.unit_id and theirs.entity_id <> mine.entity_id
            join public.entities x on x.id = theirs.entity_id and x.retired_at is null and x.merged_into_id is null
            join public.entity_profiles p on p.entity_id = x.id and p.is_stakeholder and not p.hidden
            where mine.entity_id = p_entity_id group by x.id, x.name, p.kind, x.type order by count(distinct mine.unit_id) desc limit 12) o), '[]'),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('sourceId', s.id, 'title', s.title, 'claims', t.claims) order by t.claims desc, s.title)
      from (select ps.source_id, count(distinct u.id) claims
            from public.unit_entities ue join public.units u on u.id = ue.unit_id and u.retired_at is null
            join public.revisions r on r.id = u.current_revision_id
            join public.passages ps on ps.id = any (r.passage_ids)
            where ue.entity_id = p_entity_id group by ps.source_id) t
      join public.sources s on s.id = t.source_id), '[]')
  )
$$;
grant execute on function public.stakeholder_detail(uuid) to authenticated, service_role;

-- HOW MANY LIVE ENTITIES STILL NEED A CARD (never written, or written from older evidence)
create function public.entity_profiles_missing()
returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from public.entities e
  where e.retired_at is null and e.merged_into_id is null
    and exists (select 1 from public.unit_entities ue join public.units u on u.id = ue.unit_id where ue.entity_id = e.id and u.retired_at is null)
    and not exists (select 1 from public.entity_profiles p where p.entity_id = e.id and p.generated_at is not null)
$$;
grant execute on function public.entity_profiles_missing() to authenticated, service_role;


notify pgrst, 'reload schema';
