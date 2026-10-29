-- =====================================================================
-- SECOND BRAIN · STUDY
-- =====================================================================
-- Practice questions built from a scope's claims (docs/knowledge-modules-
-- plan.md, section 1). A study set belongs to the space; its items each test
-- one claim and keep the revision they were written from, so a new revision
-- marks them stale. Levels and review dates are per person and per claim
-- (study_progress), because several questions can test one claim.
--
-- 1. TABLES: study_sets, study_items, study_attempts, study_progress.
--    B-tree indexes only (OrioleDB, AGENTS.md).
-- 2. FUNCTIONS for the server (owned by space_runtime, executable by
--    service_role and space_runtime, like set_module_enabled). The level
--    and next review are worked out in lib/study/levels.ts; the database
--    only stores them.
-- =====================================================================

grant create on schema public to space_runtime;


-- =====================================================================
-- 1. TABLES
-- =====================================================================

create table public.study_sets (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null default public.current_space_id() references public.spaces (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  scope_kind text not null check (scope_kind in ('topic', 'article', 'entity', 'glossary')),
  scope_id uuid,
  coverage smallint not null check (coverage in (25, 50, 100)),
  types text[] not null check (cardinality(types) between 1 and 3 and types <@ array['flashcard', 'multiple_choice', 'short_answer']::text[]),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((scope_kind = 'glossary') = (scope_id is null)),
  unique (space_id, id)
);
comment on table public.study_sets is 'Study: a set of practice questions built from a scope (topic, article, entity or glossary).';
create index study_sets_recent_idx on public.study_sets (space_id, created_at);

-- One question on one claim. revision_id is the claim revision it was written from:
-- when the claim gets a new revision the item is marked stale and rebuilt.
create table public.study_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null default public.current_space_id() references public.spaces (id) on delete cascade,
  set_id uuid not null,
  unit_id uuid not null,
  revision_id uuid not null,
  kind text not null check (kind in ('flashcard', 'multiple_choice', 'short_answer')),
  prompt text not null check (length(btrim(prompt)) between 1 and 2000),
  answer text not null check (length(btrim(answer)) between 1 and 2000),
  -- multiple choice: four options, the answer among them; null for the other kinds
  choices jsonb check (choices is null or jsonb_typeof(choices) = 'array'),
  explanation text not null default '',
  stale boolean not null default false,
  created_at timestamptz not null default now(),
  check ((kind = 'multiple_choice') = (choices is not null)),
  foreign key (space_id, set_id) references public.study_sets (space_id, id) on delete cascade,
  foreign key (space_id, unit_id) references public.units (space_id, id)
);
create index study_items_set_idx on public.study_items (space_id, set_id);
create index study_items_unit_idx on public.study_items (space_id, unit_id);

create table public.study_attempts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null default public.current_space_id() references public.spaces (id) on delete cascade,
  item_id uuid not null references public.study_items (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  response text not null default '',
  result text not null check (result in ('right', 'partly', 'wrong')),
  feedback text,
  created_at timestamptz not null default now()
);
create index study_attempts_item_idx on public.study_attempts (item_id, created_at);
create index study_attempts_user_idx on public.study_attempts (user_id, created_at);

-- A person's level on one claim: 0 New, 1 Familiar, 2 Known, 3 Learned. `ease` is kept
-- from day one so an SM-2 schedule can replace the boxes later without a schema change.
create table public.study_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  unit_id uuid not null,
  space_id uuid not null default public.current_space_id() references public.spaces (id) on delete cascade,
  level smallint not null default 0 check (level between 0 and 3),
  ease real not null default 2.5,
  due_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, unit_id),
  foreign key (space_id, unit_id) references public.units (space_id, id)
);
create index study_progress_due_idx on public.study_progress (user_id, due_at);

do $$ declare t text; begin
 foreach t in array array['study_sets', 'study_items', 'study_attempts', 'study_progress'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('alter table public.%I force row level security', t);
  execute format('create policy space_server on public.%I for all to space_runtime using (space_id = (select public.current_space_id())) with check (space_id = (select public.current_space_id()))', t);
  execute format('grant select, insert, update, delete on public.%I to space_runtime', t);
 end loop;
end $$;
-- The browser sees the space's sets and questions, and only its own answers and levels
create policy space_browser_boundary on public.study_sets for select to authenticated
  using (space_id = any (array(select unnest(public.readable_space_ids()))));
create policy space_browser_boundary on public.study_items for select to authenticated
  using (space_id = any (array(select unnest(public.readable_space_ids()))));
create policy own_rows on public.study_attempts for select to authenticated
  using (user_id = (select auth.uid()) and space_id = any (array(select unnest(public.readable_space_ids()))));
create policy own_rows on public.study_progress for select to authenticated
  using (user_id = (select auth.uid()) and space_id = any (array(select unnest(public.readable_space_ids()))));
grant select on public.study_sets, public.study_items, public.study_attempts, public.study_progress to authenticated;


-- =====================================================================
-- 2. FUNCTIONS
-- =====================================================================

-- WRITE: a new, empty set; its questions follow in batches (add_study_items)
create function public.create_study_set(p_title text, p_scope_kind text, p_scope_id uuid, p_coverage integer, p_types text[], p_user_id uuid)
returns uuid
language sql
set search_path = ''
as $$
  insert into public.study_sets (title, scope_kind, scope_id, coverage, types, created_by)
  values (btrim(p_title), p_scope_kind, p_scope_id, p_coverage, p_types, p_user_id)
  returning id;
$$;

-- WRITE: one batch of questions, [{unitId, revisionId, kind, prompt, answer, choices, explanation}]
create function public.add_study_items(p_set_id uuid, p_items jsonb)
returns integer
language sql
set search_path = ''
as $$
  with added as (
    insert into public.study_items (set_id, unit_id, revision_id, kind, prompt, answer, choices, explanation)
    select p_set_id, (x ->> 'unitId')::uuid, (x ->> 'revisionId')::uuid, x ->> 'kind', x ->> 'prompt', x ->> 'answer',
      case when jsonb_typeof(x -> 'choices') = 'array' then x -> 'choices' end, coalesce(x ->> 'explanation', '')
    from jsonb_array_elements(p_items) x
    returning 1
  )
  select count(*)::integer from added;
$$;

-- WRITE: a regenerated question takes the place of the old one, written from the claim's current revision
create function public.replace_study_item(p_item_id uuid, p_item jsonb)
returns void
language sql
set search_path = ''
as $$
  update public.study_items set
    revision_id = (p_item ->> 'revisionId')::uuid, kind = p_item ->> 'kind', prompt = p_item ->> 'prompt', answer = p_item ->> 'answer',
    choices = case when jsonb_typeof(p_item -> 'choices') = 'array' then p_item -> 'choices' end,
    explanation = coalesce(p_item ->> 'explanation', ''), stale = false
  where id = p_item_id;
$$;

create function public.remove_study_item(p_item_id uuid)
returns void
language sql
set search_path = ''
as $$
  delete from public.study_items where id = p_item_id;
$$;

-- WRITE: marks the items whose claim has a newer revision (or was retired) as stale; returns how many changed
create function public.mark_stale_study_items(p_set_id uuid default null)
returns integer
language sql
set search_path = ''
as $$
  with marked as (
    update public.study_items i set stale = true
    from public.units u
    where u.id = i.unit_id and not i.stale and (p_set_id is null or i.set_id = p_set_id)
      and (u.current_revision_id is distinct from i.revision_id or u.retired_at is not null)
    returning 1
  )
  select count(*)::integer from marked;
$$;

-- READ: one item with the claim revision it was written from (grading and answers)
create function public.read_study_item(p_item_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'setId', i.set_id, 'unitId', i.unit_id, 'revisionId', i.revision_id, 'kind', i.kind,
    'prompt', i.prompt, 'answer', i.answer, 'choices', i.choices, 'explanation', i.explanation, 'stale', i.stale,
    'claim', jsonb_build_object('title', r.title, 'content', coalesce(r.content, ''))
  )
  from public.study_items i
  left join public.revisions r on r.id = i.revision_id
  where i.id = p_item_id;
$$;

-- READ: the current revision of live claims (regenerating stale questions)
create function public.read_study_claims(p_unit_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('unitId', u.id, 'revisionId', r.id, 'title', r.title, 'content', r.content, 'createdAt', r.created_at, 'citedBy', 0)), '[]'::jsonb)
  from public.units u join public.revisions r on r.id = u.current_revision_id
  where u.id = any (p_unit_ids) and u.retired_at is null;
$$;

-- READ: a person's level on one claim, or null when they never answered it
create function public.read_study_progress(p_user_id uuid, p_unit_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('unitId', p.unit_id, 'level', p.level, 'ease', p.ease, 'dueAt', p.due_at, 'lastSeenAt', p.last_seen_at)
  from public.study_progress p
  where p.user_id = p_user_id and p.unit_id = p_unit_id;
$$;

-- WRITE: one answer and the person's new level on the claim (worked out by lib/study/levels.ts)
create function public.record_study_attempt(p_item_id uuid, p_user_id uuid, p_response text, p_result text, p_feedback text, p_progress jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  claim uuid;
begin
  select unit_id into claim from public.study_items where id = p_item_id;
  if claim is null then raise exception 'This question was removed.' using errcode = 'P0002'; end if;
  insert into public.study_attempts (item_id, user_id, response, result, feedback)
  values (p_item_id, p_user_id, coalesce(p_response, ''), p_result, p_feedback);
  insert into public.study_progress as p (user_id, unit_id, level, ease, due_at, last_seen_at)
  values (p_user_id, claim, (p_progress ->> 'level')::smallint, (p_progress ->> 'ease')::real,
    (p_progress ->> 'dueAt')::timestamptz, (p_progress ->> 'lastSeenAt')::timestamptz)
  on conflict (user_id, unit_id) do update set
    level = excluded.level, ease = excluded.ease, due_at = excluded.due_at, last_seen_at = excluded.last_seen_at;
end;
$$;

-- READ: sets with their items, the claims they test (current revision) and one person's levels.
-- p_set_id null reads every set in the space (Start review mixes them).
create function public.read_study_sets(p_user_id uuid, p_set_id uuid default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with sets as (
    select * from public.study_sets where p_set_id is null or id = p_set_id
  ), items as (
    select i.* from public.study_items i join sets s on s.id = i.set_id
  ), claims as (
    select distinct on (u.id) u.id unit_id, r.title, coalesce(r.content, '') content, u.retired_at is not null retired
    from items i join public.units u on u.id = i.unit_id left join public.revisions r on r.id = u.current_revision_id
  )
  select jsonb_build_object(
    'sets', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'title', s.title, 'scopeKind', s.scope_kind, 'scopeId', s.scope_id, 'coverage', s.coverage,
      'types', to_jsonb(s.types), 'createdAt', s.created_at) order by s.created_at desc) from sets s), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'setId', i.set_id, 'unitId', i.unit_id, 'revisionId', i.revision_id, 'kind', i.kind, 'prompt', i.prompt,
      'answer', i.answer, 'choices', i.choices, 'explanation', i.explanation, 'stale', i.stale) order by i.created_at, i.id) from items i), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(jsonb_build_object('unitId', c.unit_id, 'title', c.title, 'content', c.content, 'retired', c.retired)) from claims c), '[]'::jsonb),
    'progress', coalesce((select jsonb_agg(jsonb_build_object('unitId', p.unit_id, 'level', p.level, 'ease', p.ease, 'dueAt', p.due_at, 'lastSeenAt', p.last_seen_at))
      from public.study_progress p where p.user_id = p_user_id and p.unit_id in (select unit_id from claims)), '[]'::jsonb)
  );
$$;

do $$ declare f regprocedure; begin
 foreach f in array array[
  'public.create_study_set(text,text,uuid,integer,text[],uuid)'::regprocedure,
  'public.add_study_items(uuid,jsonb)'::regprocedure,
  'public.replace_study_item(uuid,jsonb)'::regprocedure,
  'public.remove_study_item(uuid)'::regprocedure,
  'public.mark_stale_study_items(uuid)'::regprocedure,
  'public.read_study_item(uuid)'::regprocedure,
  'public.read_study_claims(uuid[])'::regprocedure,
  'public.read_study_progress(uuid,uuid)'::regprocedure,
  'public.record_study_attempt(uuid,uuid,text,text,text,jsonb)'::regprocedure,
  'public.read_study_sets(uuid,uuid)'::regprocedure
 ] loop
  execute format('alter function %s owner to space_runtime', f);
  execute format('revoke execute on function %s from public, anon, authenticated', f);
  execute format('grant execute on function %s to service_role, space_runtime', f);
 end loop;
end $$;

revoke create on schema public from space_runtime;

notify pgrst, 'reload schema';
