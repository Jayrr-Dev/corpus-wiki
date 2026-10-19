-- Rank live vectors before reading revision content. Joining every matching
-- revision before LIMIT was expensive on OrioleDB and timed out under load.
-- The current-revision FK guarantees each ranked row has its visible revision
-- in the same space. Keep RLS, threshold, model and retirement checks intact.
create or replace function public.similar_units(p_embedding text, p_model text, p_limit integer, p_min double precision)
returns table (unit_id uuid, revision_id uuid, content text, similarity double precision)
language sql stable set search_path = '' as $$
  with ranked as materialized (
    select u.id as unit_id, e.revision_id,
      e.embedding operator(extensions.<=>) p_embedding::extensions.vector as distance
    from public.unit_embeddings e
    join public.units u on u.current_revision_id = e.revision_id and u.retired_at is null
      and u.space_id = e.space_id
    where e.model = p_model
      and e.space_id = (select public.current_space_id())
      and 1 - (e.embedding operator(extensions.<=>) p_embedding::extensions.vector) >= p_min
    order by e.embedding operator(extensions.<=>) p_embedding::extensions.vector
    limit p_limit
  )
  select ranked.unit_id, ranked.revision_id, r.content, 1 - ranked.distance as similarity
  from ranked join public.revisions r on r.id = ranked.revision_id
    and r.space_id = (select public.current_space_id())
  order by ranked.distance
$$;
