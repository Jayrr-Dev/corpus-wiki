-- =====================================================================
-- PASSAGE EMBEDDINGS: source text as vectors, so the chatbot finds what a
-- source says by meaning even when no claim was drawn from it. Its own
-- table: passages never change (a vector lives until its passage does),
-- and searches over claims must never return raw source text.
-- No vector index: OrioleDB only runs B-tree natively, and a few thousand
-- passages scan quickly without one. Server only (service role).
-- =====================================================================

create table public.passage_embeddings (
  passage_id uuid not null references public.passages (id) on delete cascade,
  model text not null,
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now(),
  primary key (passage_id, model)
);
comment on table public.passage_embeddings is 'One source passage as a vector, for finding source text by meaning.';
alter table public.passage_embeddings enable row level security;
grant all on public.passage_embeddings to service_role;

-- PASSAGES OF LIVE SOURCES WITH NO VECTOR YET (for this model)
create function public.missing_passage_embeddings(p_model text, p_limit integer)
returns table (passage_id uuid, text text)
language sql stable
set search_path = ''
as $$
  select p.id, p.text
  from public.passages p
  join public.sources s on s.id = p.source_id and s.archived_at is null and s.replaced_by_id is null
  where btrim(p.text) <> ''
    and not exists (select 1 from public.passage_embeddings e where e.passage_id = p.id and e.model = p_model)
  order by p.source_id, p.position
  limit greatest(1, least(p_limit, 256))
$$;

-- SAVES VECTORS: [{ passageId, model, embedding: number[] }]
create function public.save_passage_embeddings(p_rows jsonb)
returns integer
language sql
set search_path = ''
as $$
  with saved as (
    insert into public.passage_embeddings (passage_id, model, embedding)
    select (x ->> 'passageId')::uuid, x ->> 'model', (x -> 'embedding')::text::extensions.vector
    from jsonb_array_elements(p_rows) x
    where exists (select 1 from public.passages p where p.id = (x ->> 'passageId')::uuid)
    on conflict (passage_id, model) do update set embedding = excluded.embedding, created_at = now()
    returning 1
  )
  select count(*)::integer from saved
$$;

-- PASSAGES OF LIVE SOURCES NEAREST TO A VECTOR (cosine similarity, most alike first)
create function public.similar_passages(p_embedding text, p_model text, p_limit integer, p_min double precision)
returns table (passage_id uuid, source_id uuid, text text, similarity double precision)
language sql stable
set search_path = ''
as $$
  select p.id, p.source_id, p.text, 1 - (e.embedding operator(extensions.<=>) p_embedding::extensions.vector) as similarity
  from public.passage_embeddings e
  join public.passages p on p.id = e.passage_id
  join public.sources s on s.id = p.source_id and s.archived_at is null and s.replaced_by_id is null
  where e.model = p_model
    and 1 - (e.embedding operator(extensions.<=>) p_embedding::extensions.vector) >= p_min
  order by e.embedding operator(extensions.<=>) p_embedding::extensions.vector
  limit greatest(1, least(p_limit, 32))
$$;

revoke execute on function public.missing_passage_embeddings(text, integer) from public, anon, authenticated;
revoke execute on function public.save_passage_embeddings(jsonb) from public, anon, authenticated;
revoke execute on function public.similar_passages(text, text, integer, double precision) from public, anon, authenticated;
grant execute on function public.missing_passage_embeddings(text, integer) to service_role;
grant execute on function public.save_passage_embeddings(jsonb) to service_role;
grant execute on function public.similar_passages(text, text, integer, double precision) to service_role;

notify pgrst, 'reload schema';
