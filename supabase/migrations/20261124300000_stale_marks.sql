-- =====================================================================
-- STALE MARKS (#46, glossary first; closes #34)
-- =====================================================================
-- Derived knowledge is rebuilt like a build system:
--   claim_dependencies  what each derived item was built from: one row per
--                       (kind, item, claim) with the claim revision it used
--   stale_marks         items to redo. A trigger on units marks them in the
--                       same transaction as every committed claim change
--                       (add, revise, merge, retire, context change), and so
--                       does Undo, which restores the same columns
-- A stage reads its marks, rebuilds only those items, then clears the marks
-- it read. A mark set again while the stage ran has a newer version and stays.
-- Both tables are rebuildable from canonical data (rebuild_stale_marks).
--
-- Glossary kinds:
--   glossary_claim  the claim itself: its terms are read again. Every claim
--                   change marks it, so new claims are found without a scan.
--                   Its dependency row is the revision the glossary last read.
--   glossary_entry  a published meaning (item = meaningId) citing the claim
-- B-tree indexes only (OrioleDB, AGENTS.md).
-- =====================================================================

create table public.claim_dependencies (
  space_id uuid not null default public.current_space_id() references public.spaces (id) on delete cascade,
  kind text not null constraint claim_dependencies_kind check (kind in ('glossary_claim', 'glossary_entry')),
  item_key text not null,
  unit_id uuid not null references public.units (id) on delete cascade,
  -- The revision the item was built from; staleness is this against the claim's current one
  revision_id uuid,
  primary key (space_id, kind, item_key, unit_id)
);
create index claim_dependencies_unit on public.claim_dependencies (unit_id, kind);

create sequence public.stale_mark_versions;
create table public.stale_marks (
  space_id uuid not null default public.current_space_id() references public.spaces (id) on delete cascade,
  kind text not null constraint stale_marks_kind check (kind in ('glossary_claim', 'glossary_entry')),
  item_key text not null,
  version bigint not null default nextval('public.stale_mark_versions'),
  marked_at timestamptz not null default clock_timestamp(),
  primary key (space_id, kind, item_key)
);

do $$
declare t text;
begin
  foreach t in array array['claim_dependencies', 'stale_marks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy space_boundary on public.%I as restrictive for all to space_runtime using (space_id = (select public.current_space_id())) with check (space_id = (select public.current_space_id()))', t);
    execute format('create policy space_server on public.%I for all to space_runtime using (true) with check (true)', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to space_runtime, service_role', t);
  end loop;
end $$;
grant usage on sequence public.stale_mark_versions to space_runtime, service_role;

-- MARK: the claim's own kinds, and every item the index says was built from it.
-- Every claim change moves the unit's current revision or retirement: commits,
-- merges (the duplicate retires, the survivor is revised) and Undo alike.
-- It runs once per changed claim inside large commits, so it is kept to two
-- statements with qualified names and no per-call settings (a SET clause costs
-- a configuration save and restore on every row).
create function change_control.claim_changed()
returns trigger
language plpgsql
as $$
begin
  insert into public.stale_marks (space_id, kind, item_key) values (new.space_id, 'glossary_claim', new.id::text)
  on conflict (space_id, kind, item_key) do update set version = nextval('public.stale_mark_versions'), marked_at = clock_timestamp();
  insert into public.stale_marks (space_id, kind, item_key)
  select new.space_id, d.kind, d.item_key from public.claim_dependencies d
  where d.unit_id = new.id and d.kind <> 'glossary_claim' and d.space_id = new.space_id
  on conflict (space_id, kind, item_key) do update set version = nextval('public.stale_mark_versions'), marked_at = clock_timestamp();
  return null;
end $$;
-- A new claim has nothing built from it yet: only its own mark
create function change_control.claim_added()
returns trigger
language plpgsql
as $$
begin
  insert into public.stale_marks (space_id, kind, item_key) values (new.space_id, 'glossary_claim', new.id::text)
  on conflict (space_id, kind, item_key) do update set version = nextval('public.stale_mark_versions'), marked_at = clock_timestamp();
  return null;
end $$;
create trigger mark_new_claim after insert on public.units
for each row execute function change_control.claim_added();
create trigger mark_claim_dependents after update of current_revision_id, retired_at on public.units
for each row when (new.current_revision_id is distinct from old.current_revision_id or new.retired_at is distinct from old.retired_at)
execute function change_control.claim_changed();

-- READ: a stage's marks with their versions, oldest first
create function public.read_stale_marks(p_kinds text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', m.kind, 'key', m.item_key, 'version', m.version) order by m.version), '[]')
  from public.stale_marks m
  where m.space_id = public.current_space_id() and m.kind = any (p_kinds)
$$;

-- CLEAR: only the versions a stage read; a newer mark means the item changed again
create function change_control.clear_stale_marks(p_space uuid, p_marks jsonb)
returns void
language sql
set search_path = ''
as $$
  delete from public.stale_marks m
  using jsonb_to_recordset(coalesce(p_marks, '[]')) x(kind text, key text, version bigint)
  where m.space_id = p_space and m.kind = x.kind and m.item_key = x.key and m.version <= x.version
$$;
create function public.clear_stale_marks(p_marks jsonb)
returns void
language sql
security definer
set search_path = ''
as $$ select change_control.clear_stale_marks(public.current_space_id(), p_marks) $$;

-- GLOSSARY INDEX: each published meaning depends on the claims it and its usage notes cite
create function change_control.index_glossary_entries(p_space uuid, p_entries jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.claim_dependencies where space_id = p_space and kind = 'glossary_entry';
  insert into public.claim_dependencies (space_id, kind, item_key, unit_id, revision_id)
  select distinct on (meaning, u.id) p_space, 'glossary_entry', meaning, u.id, revision
  from (
    select e ->> 'meaningId' meaning, c ->> 'unitId' unit, c ->> 'revisionId' revision_text
    from jsonb_array_elements(coalesce(p_entries, '[]')) e
    cross join lateral (
      select value c from jsonb_array_elements(coalesce(e -> 'citations', '[]'))
      union all
      select c from jsonb_array_elements(coalesce(e -> 'usageNotes', '[]')) n,
        jsonb_array_elements(coalesce(n -> 'citations', '[]')) c
    ) cites
    where nullif(e ->> 'meaningId', '') is not null
  ) cited
  join public.units u on u.id::text = cited.unit and u.space_id = p_space
  cross join lateral (select r.id revision from public.revisions r where r.id::text = cited.revision_text) r
  order by meaning, u.id, revision;
end $$;

-- GLOSSARY READS: the revision of each claim the run read; null when the claim had gone.
-- p_complete replaces every row (a full rebuild read the whole store).
create function change_control.record_glossary_reads(p_space uuid, p_considered jsonb, p_complete boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_complete then
    delete from public.claim_dependencies where space_id = p_space and kind = 'glossary_claim';
  else
    delete from public.claim_dependencies d
    using jsonb_to_recordset(p_considered) x("unitId" text)
    where d.space_id = p_space and d.kind = 'glossary_claim' and d.item_key = x."unitId";
  end if;
  insert into public.claim_dependencies (space_id, kind, item_key, unit_id, revision_id)
  select p_space, 'glossary_claim', u.id::text, u.id, r.id
  from jsonb_to_recordset(p_considered) x("unitId" text, "revisionId" text)
  join public.units u on u.id::text = x."unitId" and u.space_id = p_space
  join public.revisions r on r.id::text = x."revisionId"
  on conflict do nothing;
end $$;

-- PUBLISH: the 20261119007000 publication, plus the index and the marks it cleared, atomically
alter function public.publish_glossary_meanings(uuid, text, jsonb, jsonb, jsonb, jsonb) rename to publish_glossary_meanings_before_marks;
create function public.publish_glossary_meanings(p_token uuid, p_hash text, p_entries jsonb, p_pending jsonb, p_registry jsonb, p_batches jsonb,
  p_considered jsonb default null, p_complete boolean default false, p_marks jsonb default '[]')
returns void
language plpgsql
security definer
set search_path = ''
set jit = off
as $$
declare
  v_space uuid := public.current_space_id();
  v_entries text;
begin
  perform public.publish_glossary_meanings_before_marks(p_token, p_hash, p_entries, p_pending, p_registry, p_batches);
  -- Index what was published (overrides applied, deletions removed), read back through text (OrioleDB detoast)
  select entries::text into v_entries from public.glossary_state where space_id = v_space and id;
  perform change_control.index_glossary_entries(v_space, v_entries::jsonb);
  if p_considered is not null then perform change_control.record_glossary_reads(v_space, p_considered, p_complete); end if;
  perform change_control.clear_stale_marks(v_space, p_marks);
end $$;

-- REBUILD from canonical data: the entry index from the published glossary, and every
-- mark a dependency row implies (an item built from a revision that is no longer current).
-- A live claim the glossary never read is marked too: only unread claims need it.
create function change_control.rebuild_stale_marks_in(p_space uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_entries text;
  v_marked integer;
begin
  select entries::text into v_entries from public.glossary_state where space_id = p_space and id;
  perform change_control.index_glossary_entries(p_space, coalesce(v_entries, '[]')::jsonb);
  delete from public.stale_marks where space_id = p_space and kind in ('glossary_claim', 'glossary_entry');
  insert into public.stale_marks (space_id, kind, item_key)
  select distinct p_space, d.kind, d.item_key from public.claim_dependencies d
  join public.units u on u.id = d.unit_id
  where d.space_id = p_space and d.kind in ('glossary_claim', 'glossary_entry')
    and (u.retired_at is not null or u.current_revision_id is distinct from d.revision_id)
  union
  select p_space, 'glossary_claim', u.id::text from public.units u
  where u.space_id = p_space and u.retired_at is null and not exists (
    select 1 from public.claim_dependencies d where d.space_id = p_space and d.kind = 'glossary_claim' and d.unit_id = u.id);
  get diagnostics v_marked = row_count;
  return jsonb_build_object('marked', v_marked);
end $$;
create function public.rebuild_stale_marks()
returns jsonb
language sql
security definer
set search_path = ''
as $$ select change_control.rebuild_stale_marks_in(public.current_space_id()) $$;

-- Existing spaces start from their published glossaries. No claim has a recorded
-- read yet, so the first run reads every claim once, reusing the saved batch answers.
select change_control.rebuild_stale_marks_in(id) from public.spaces;

grant create on schema public to space_runtime;
do $$
declare f text;
begin
  foreach f in array array[
    'public.read_stale_marks(text[])', 'public.clear_stale_marks(jsonb)', 'public.rebuild_stale_marks()',
    'public.publish_glossary_meanings(uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb)',
    'public.publish_glossary_meanings_before_marks(uuid,text,jsonb,jsonb,jsonb,jsonb)'] loop
    execute format('alter function %s owner to space_runtime', f);
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role, space_runtime', f);
  end loop;
end $$;
revoke create on schema public from space_runtime;
revoke execute on all functions in schema change_control from public, anon, authenticated;
-- Commits and Undo run as space_runtime; the trigger and the security definer functions call these
grant execute on function change_control.claim_changed(), change_control.claim_added(),
  change_control.clear_stale_marks(uuid, jsonb), change_control.index_glossary_entries(uuid, jsonb),
  change_control.record_glossary_reads(uuid, jsonb, boolean), change_control.rebuild_stale_marks_in(uuid) to space_runtime;
notify pgrst, 'reload schema';
