-- =====================================================================
-- STALE MARKS FOR THE OTHER STAGES (#46, after 20261124300000)
-- =====================================================================
-- The same marks as the glossary's, for the rest of what is built from claims:
--   section             a generated section (item = section id). Its index is
--                       section_inputs (the claims it cites, with the revision);
--                       every other way a section goes stale (a claim joining
--                       its query, Undo) already sets sections.status = 'stale',
--                       which now leaves a mark too. A build that finishes
--                       (status back to 'current') clears it.
--   topic_placement     a live claim with no topic yet (item = unit id). Filing
--                       it clears the mark; losing its last topic sets it again.
--   entity_description  an entity (item = canonical entity id) whose claims or
--   entity_profile      identity changed. Its index is unit_entities.
-- Every mark is set in the same transaction as the change, including Undo.
-- Nothing is backfilled except unfiled claims: the first runs pick up only new
-- changes, so no stage starts with a backlog. rebuild_stale_marks(kinds)
-- recomputes any kind from canonical data on demand.
-- B-tree indexes only (OrioleDB, AGENTS.md).
-- =====================================================================

alter table public.claim_dependencies drop constraint claim_dependencies_kind;
alter table public.claim_dependencies add constraint claim_dependencies_kind check (kind in ('glossary_claim', 'glossary_entry'));
alter table public.stale_marks drop constraint stale_marks_kind;
alter table public.stale_marks add constraint stale_marks_kind check (kind in ('glossary_claim', 'glossary_entry',
  'section', 'topic_placement', 'entity_description', 'entity_profile'));

-- ONE MARK, set again with a newer version when it already exists
create function change_control.mark_stale(p_space uuid, p_kind text, p_key text)
returns void
language sql
as $$
  insert into public.stale_marks (space_id, kind, item_key) values (p_space, p_kind, p_key)
  on conflict (space_id, kind, item_key) do update set version = nextval('public.stale_mark_versions'), marked_at = clock_timestamp();
$$;

-- CLAIM CHANGED (revision or retirement): the 20261124300000 glossary marks, plus the
-- sections citing it, its entities, and its filing. Undo moves the same columns.
create or replace function change_control.claim_changed()
returns trigger
language plpgsql
as $$
begin
  insert into public.stale_marks (space_id, kind, item_key)
  values (new.space_id, 'glossary_claim', new.id::text)
  union all
  select new.space_id, d.kind, d.item_key from public.claim_dependencies d
  where d.unit_id = new.id and d.kind <> 'glossary_claim' and d.space_id = new.space_id
  union all
  select new.space_id, 'section', si.section_id::text from public.section_inputs si where si.unit_id = new.id
  union all
  select distinct new.space_id, k.kind, public.entity_canonical_id(ue.entity_id)::text
  from public.unit_entities ue cross join (values ('entity_description'), ('entity_profile')) k(kind)
  where ue.unit_id = new.id
  on conflict (space_id, kind, item_key) do update set version = nextval('public.stale_mark_versions'), marked_at = clock_timestamp();
  if new.retired_at is not null then
    delete from public.stale_marks where space_id = new.space_id and kind = 'topic_placement' and item_key = new.id::text;
  elsif not exists (select 1 from public.unit_domains where unit_id = new.id) then
    perform change_control.mark_stale(new.space_id, 'topic_placement', new.id::text);
  end if;
  return null;
end $$;

-- A NEW CLAIM has no sections, entities or topics yet: its glossary and filing marks
create or replace function change_control.claim_added()
returns trigger
language plpgsql
as $$
begin
  insert into public.stale_marks (space_id, kind, item_key)
  values (new.space_id, 'glossary_claim', new.id::text), (new.space_id, 'topic_placement', new.id::text)
  on conflict (space_id, kind, item_key) do update set version = nextval('public.stale_mark_versions'), marked_at = clock_timestamp();
  return null;
end $$;

-- ENTITY LINKS: a claim joining or leaving an entity changes what describes it.
-- Statement triggers: one insert per projection, however many links it writes.
create function change_control.entity_links_changed()
returns trigger
language plpgsql
as $$
begin
  insert into public.stale_marks (space_id, kind, item_key)
  select distinct l.space_id, k.kind, public.entity_canonical_id(l.entity_id)::text
  from changed_links l cross join (values ('entity_description'), ('entity_profile')) k(kind)
  on conflict (space_id, kind, item_key) do update set version = nextval('public.stale_mark_versions'), marked_at = clock_timestamp();
  return null;
end $$;
create trigger mark_linked_entities after insert on public.unit_entities
referencing new table as changed_links for each statement execute function change_control.entity_links_changed();
create trigger mark_unlinked_entities after delete on public.unit_entities
referencing old table as changed_links for each statement execute function change_control.entity_links_changed();

-- ENTITY IDENTITY: created, renamed, retyped, merged or retired
create function change_control.entity_changed()
returns trigger
language plpgsql
as $$
begin
  insert into public.stale_marks (space_id, kind, item_key)
  select distinct new.space_id, k.kind, public.entity_canonical_id(new.id)::text
  from (values ('entity_description'), ('entity_profile')) k(kind)
  on conflict (space_id, kind, item_key) do update set version = nextval('public.stale_mark_versions'), marked_at = clock_timestamp();
  return null;
end $$;
create trigger mark_new_entity after insert on public.entities
for each row execute function change_control.entity_changed();
create trigger mark_changed_entity after update of name, type, merged_into_id, retired_at on public.entities
for each row when (new.name is distinct from old.name or new.type is distinct from old.type
  or new.merged_into_id is distinct from old.merged_into_id or new.retired_at is distinct from old.retired_at)
execute function change_control.entity_changed();

-- FILING: a topic clears the claim's mark; losing the last one sets it again
create function change_control.claim_topics_added()
returns trigger
language plpgsql
as $$
begin
  delete from public.stale_marks m using (select distinct space_id, unit_id from filed) f
  where m.space_id = f.space_id and m.kind = 'topic_placement' and m.item_key = f.unit_id::text;
  return null;
end $$;
create function change_control.claim_topics_removed()
returns trigger
language plpgsql
as $$
begin
  insert into public.stale_marks (space_id, kind, item_key)
  select distinct f.space_id, 'topic_placement', f.unit_id::text from filed f
  join public.units u on u.id = f.unit_id
  where u.retired_at is null and not exists (select 1 from public.unit_domains d where d.unit_id = f.unit_id)
  on conflict (space_id, kind, item_key) do update set version = nextval('public.stale_mark_versions'), marked_at = clock_timestamp();
  return null;
end $$;
create trigger clear_filed_claims after insert on public.unit_domains
referencing new table as filed for each statement execute function change_control.claim_topics_added();
create trigger mark_unfiled_claims after delete on public.unit_domains
referencing old table as filed for each statement execute function change_control.claim_topics_removed();

-- SECTION STATUS: every existing path to 'stale' leaves a mark; a finished or retired build clears it
create function change_control.section_status_changed()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'stale' and new.retired_at is null then
    perform change_control.mark_stale(new.space_id, 'section', new.id::text);
  else
    delete from public.stale_marks where space_id = new.space_id and kind = 'section' and item_key = new.id::text;
  end if;
  return null;
end $$;
create trigger mark_stale_section after update of status, retired_at on public.sections
for each row when (new.status is distinct from old.status or new.retired_at is distinct from old.retired_at)
execute function change_control.section_status_changed();

-- PAGES: the generated sections to rebuild after an event, from the section marks.
-- Links and set members change a section's claims without a new revision; an event
-- with those still adds the affected-section search (20261119006000).
create function public.list_stale_sections(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
set jit = off
as $$
  with marked as (
    select s.id, s.page_id, s.position from public.stale_marks m
    join public.sections s on s.id::text = m.item_key and s.space_id = m.space_id
    join public.pages p on p.id = s.page_id
    where m.space_id = public.current_space_id() and m.kind = 'section'
      and s.mode = 'generated' and s.retired_at is null and p.retired_at is null
  ), linked as (
    select (x ->> 'sectionId')::uuid id, (x ->> 'pageId')::uuid page_id, s.position
    from jsonb_array_elements(case when exists (
      select 1 from public.actions a join public.change_sets cs on cs.id = a.change_set_id
      where cs.event_id = p_event_id and a.outcome = 'applied' and a.type::text in ('link', 'set_member'))
      then public.list_affected_sections(p_event_id) else '[]' end) x
    join public.sections s on s.id = (x ->> 'sectionId')::uuid
  ), picked as (select * from marked union select * from linked)
  select coalesce(jsonb_agg(jsonb_build_object('sectionId', id, 'pageId', page_id) order by page_id, position), '[]') from picked
$$;

-- ENTITIES: the live entities a stage must redo, and every mark it read (to clear)
create function public.read_stale_entities(p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with marks as (
    select m.item_key, m.version from public.stale_marks m
    where m.space_id = public.current_space_id() and m.kind = p_kind and p_kind in ('entity_description', 'entity_profile')
  )
  select jsonb_build_object(
    'entityIds', coalesce((select jsonb_agg(e.id order by e.id) from marks m
      join public.entities e on e.id::text = m.item_key and e.retired_at is null and e.merged_into_id is null), '[]'),
    'marks', coalesce((select jsonb_agg(jsonb_build_object('kind', p_kind, 'key', m.item_key, 'version', m.version)) from marks m), '[]'))
$$;

-- FILING: the 20261107120000 unfiled claims, found from their marks instead of the event's actions
create or replace function public.upload_unplaced_claims(p_event_id uuid)
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
      from public.stale_marks m
      join public.units u on u.id::text = m.item_key
      join public.revisions r on r.id = u.current_revision_id
      where m.space_id = public.current_space_id() and m.kind = 'topic_placement'
        and u.retired_at is null
        -- Another upload's claims wait for its own cleaning before they are filed
        and exists (select 1 from public.actions a join public.change_sets c on c.id = a.change_set_id
          where a.target_id = u.id and c.event_id = p_event_id and a.outcome = 'applied' and a.type::text in ('add_claim', 'revise_claim'))
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

-- REBUILD from canonical data, per kind (default: every kind). The glossary kinds keep the
-- 20261124300000 rules. Sections: a cited revision that is no longer current, or status
-- 'stale'. Filing: live claims with no topic. Entities: a described or profiled entity
-- with a claim changed since its text was written.
alter function change_control.rebuild_stale_marks_in(uuid) rename to rebuild_glossary_marks_in;
create function change_control.rebuild_stale_marks_in(p_space uuid, p_kinds text[] default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_kinds text[] := coalesce(p_kinds, array['glossary_claim', 'glossary_entry', 'section', 'topic_placement', 'entity_description', 'entity_profile']);
  v_result jsonb := '{}';
  v_count integer;
begin
  if v_kinds && array['glossary_claim', 'glossary_entry'] then
    v_result := v_result || change_control.rebuild_glossary_marks_in(p_space);
  end if;
  delete from public.stale_marks where space_id = p_space
    and kind = any (v_kinds) and kind in ('section', 'topic_placement', 'entity_description', 'entity_profile');
  if 'section' = any (v_kinds) then
    insert into public.stale_marks (space_id, kind, item_key)
    select distinct p_space, 'section', s.id::text from public.sections s
    where s.space_id = p_space and s.mode = 'generated' and s.retired_at is null and (s.status = 'stale' or exists (
      select 1 from public.section_inputs si join public.units u on u.id = si.unit_id
      where si.section_id = s.id and (u.retired_at is not null or u.current_revision_id is distinct from si.revision_id)));
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('section', v_count);
  end if;
  if 'topic_placement' = any (v_kinds) then
    insert into public.stale_marks (space_id, kind, item_key)
    select p_space, 'topic_placement', u.id::text from public.units u
    where u.space_id = p_space and u.retired_at is null and not exists (select 1 from public.unit_domains d where d.unit_id = u.id);
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('topic_placement', v_count);
  end if;
  if 'entity_description' = any (v_kinds) then
    insert into public.stale_marks (space_id, kind, item_key)
    select p_space, 'entity_description', e.id::text from public.entities e
    where e.space_id = p_space and e.retired_at is null and e.merged_into_id is null and e.description_updated_at is not null
      and exists (select 1 from public.unit_entities ue join public.units u on u.id = ue.unit_id
        where public.entity_canonical_id(ue.entity_id) = e.id and u.last_changed_at > e.description_updated_at);
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('entity_description', v_count);
  end if;
  if 'entity_profile' = any (v_kinds) then
    insert into public.stale_marks (space_id, kind, item_key)
    select p_space, 'entity_profile', e.id::text from public.entities e join public.entity_profiles p on p.entity_id = e.id
    where e.space_id = p_space and e.retired_at is null and e.merged_into_id is null
      and exists (select 1 from public.unit_entities ue join public.units u on u.id = ue.unit_id
        where public.entity_canonical_id(ue.entity_id) = e.id and u.last_changed_at > coalesce(p.generated_at, p.updated_at));
    get diagnostics v_count = row_count;
    v_result := v_result || jsonb_build_object('entity_profile', v_count);
  end if;
  return v_result;
end $$;
drop function public.rebuild_stale_marks();
create function public.rebuild_stale_marks(p_kinds text[] default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select change_control.rebuild_stale_marks_in(public.current_space_id(), p_kinds) $$;

-- Claims waiting for a topic today keep waiting, now with a mark
select change_control.rebuild_stale_marks_in(id, array['topic_placement']) from public.spaces;

grant create on schema public to space_runtime;
do $$
declare f text;
begin
  foreach f in array array['public.list_stale_sections(uuid)', 'public.read_stale_entities(text)', 'public.rebuild_stale_marks(text[])'] loop
    execute format('alter function %s owner to space_runtime', f);
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role, space_runtime', f);
  end loop;
end $$;
alter function public.upload_unplaced_claims(uuid) owner to space_runtime;
revoke create on schema public from space_runtime;
revoke execute on all functions in schema change_control from public, anon, authenticated;
grant execute on function change_control.mark_stale(uuid, text, text), change_control.entity_links_changed(), change_control.entity_changed(),
  change_control.claim_topics_added(), change_control.claim_topics_removed(), change_control.section_status_changed(),
  change_control.rebuild_glossary_marks_in(uuid), change_control.rebuild_stale_marks_in(uuid, text[]) to space_runtime;
notify pgrst, 'reload schema';
