-- =====================================================================
-- SECOND BRAIN · DUPLICATE DETECTION · CLAIM TITLES
-- =====================================================================
-- 1. UNIT EMBEDDINGS: each live claim revision as a vector (pgvector), so
--    claims that say the same thing in other words are found by meaning.
--    Written and read by the server only (service role).
-- 2. AUTO MERGE: an AI merge_duplicates the judge was sure of (input
--    autoMerge = true, set only by lib/ai/tokenFactory/dedupePass.ts when
--    the claims are near-identical) applies without a person. Every other
--    AI deletion still waits on Exceptions. Merges retire, never delete,
--    so each one can be undone.
-- 3. CLAIM TITLES: revisions.title, a short name that tells a claim apart
--    from others on its topic. Copied from the action that made the
--    revision; a revision without one keeps the title it replaces.
-- =====================================================================

-- 1. UNIT EMBEDDINGS ---------------------------------------------------

create extension if not exists vector with schema extensions;

create table public.unit_embeddings (
  revision_id uuid primary key references public.revisions (id) on delete cascade,
  unit_id uuid not null references public.units (id),
  model text not null,
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now()
);
comment on table public.unit_embeddings is 'One claim revision as a vector, for finding claims that say the same thing.';
create index unit_embeddings_unit_idx on public.unit_embeddings (unit_id);
create index unit_embeddings_vector_idx on public.unit_embeddings using hnsw (embedding extensions.vector_cosine_ops);
alter table public.unit_embeddings enable row level security;

-- LIVE CLAIMS NEAREST TO A VECTOR (cosine similarity, most alike first)
create or replace function public.similar_units(p_embedding text, p_model text, p_limit integer, p_min double precision)
returns table (unit_id uuid, revision_id uuid, content text, similarity double precision)
language sql stable
set search_path = ''
as $$
  select u.id, r.id, r.content, 1 - (e.embedding operator(extensions.<=>) p_embedding::extensions.vector) as similarity
  from public.unit_embeddings e
  join public.units u on u.current_revision_id = e.revision_id and u.retired_at is null
  join public.revisions r on r.id = e.revision_id
  where e.model = p_model
    and 1 - (e.embedding operator(extensions.<=>) p_embedding::extensions.vector) >= p_min
  order by e.embedding operator(extensions.<=>) p_embedding::extensions.vector
  limit p_limit
$$;

-- LIVE CLAIMS WHOSE CURRENT WORDING HAS NO VECTOR YET (for this model)
create or replace function public.missing_unit_embeddings(p_model text, p_limit integer)
returns table (unit_id uuid, revision_id uuid, content text)
language sql stable
set search_path = ''
as $$
  select u.id, r.id, r.content
  from public.units u
  join public.revisions r on r.id = u.current_revision_id
  where u.retired_at is null and btrim(r.content) <> ''
    and not exists (select 1 from public.unit_embeddings e where e.revision_id = r.id and e.model = p_model)
  order by u.created_at
  limit p_limit
$$;

-- SAVES VECTORS: [{ revisionId, unitId, model, embedding: number[] }]; a revision's vector is replaced
create or replace function public.save_unit_embeddings(p_rows jsonb)
returns integer
language sql
set search_path = ''
as $$
  with saved as (
    insert into public.unit_embeddings (revision_id, unit_id, model, embedding)
    select (x ->> 'revisionId')::uuid, (x ->> 'unitId')::uuid, x ->> 'model', (x -> 'embedding')::text::extensions.vector
    from jsonb_array_elements(p_rows) x
    on conflict (revision_id) do update set model = excluded.model, embedding = excluded.embedding, created_at = now()
    returning 1
  )
  select count(*)::integer from saved
$$;

revoke execute on function public.similar_units(text, text, integer, double precision) from public, anon, authenticated;
revoke execute on function public.missing_unit_embeddings(text, integer) from public, anon, authenticated;
revoke execute on function public.save_unit_embeddings(jsonb) from public, anon, authenticated;
grant execute on function public.similar_units(text, text, integer, double precision) to service_role;
grant execute on function public.missing_unit_embeddings(text, integer) to service_role;
grant execute on function public.save_unit_embeddings(jsonb) to service_role;

-- 2. AUTO MERGE --------------------------------------------------------

-- DELETION: the AI may propose retiring knowledge, but a person confirms it, except a
-- merge of near-identical claims the judge was sure of (still undoable: merges only retire)
create or replace function change_control.check_deletion(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case
    when p_action.type::text = 'merge_duplicates' and p_proposed_by = 'ai' and (p_action.input ->> 'autoMerge') = 'true' then null
    when p_action.type::text in ('retire_claim', 'merge_duplicates', 'retire_entity', 'retire_domain') and p_proposed_by = 'ai'
      then change_control.check('deletion', false, 'The AI wants to retire knowledge.')
  end
$$;

-- 3. CLAIM TITLES ------------------------------------------------------

alter table public.revisions add column title text;
comment on column public.revisions.title is 'Short name that tells this claim apart from others on its topic (null: derived for display).';

-- When an action records the revision it made, the revision takes the action''s title, else the one it replaces
create or replace function public.copy_action_title()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.after_revision_id is not null and new.after_revision_id is distinct from old.after_revision_id then
    update public.revisions r
    set title = coalesce(
      nullif(btrim(new.input ->> 'title'), ''),
      (select p.title from public.revisions p where p.id = r.replaces_revision_id)
    )
    where r.id = new.after_revision_id and r.title is null;
  end if;
  return null;
end $$;

create trigger actions_copy_title
after update of after_revision_id on public.actions
for each row execute function public.copy_action_title();

-- SETS TITLES: [{ revisionId, title }] (the title backfill; only empty titles are filled)
create or replace function public.save_revision_titles(p_rows jsonb)
returns integer
language sql
set search_path = ''
as $$
  with saved as (
    update public.revisions r set title = btrim(x ->> 'title')
    from jsonb_array_elements(p_rows) x
    where r.id = (x ->> 'revisionId')::uuid and r.title is null and btrim(x ->> 'title') <> ''
    returning 1
  )
  select count(*)::integer from saved
$$;
revoke execute on function public.save_revision_titles(jsonb) from public, anon, authenticated;
grant execute on function public.save_revision_titles(jsonb) to service_role;
