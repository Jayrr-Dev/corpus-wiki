-- KEYWORD SEARCH RANK: more of the question's words first
-- ts_rank_cd on an OR query counts hits, so a claim saying one word twice
-- tied with a claim holding two different words, and the tie fell to the id.
-- Rank is now the number of distinct query words the claim holds, plus
-- ts_rank_cd scaled to [0,1) (normalization 32) to order claims within that.
-- Same signature, so the owner and grants from hybrid_search carry over.

create or replace function public.search_units_text(p_query text, p_limit integer default 40)
returns table (unit_id uuid, revision_id uuid, rank real)
language sql stable
set search_path = ''
as $$
  with q as (
    select nullif(replace(plainto_tsquery('english'::regconfig, coalesce(p_query, ''))::text, ' & ', ' | '), '')::tsquery query,
           tsvector_to_array(to_tsvector('english'::regconfig, coalesce(p_query, ''))) words
  ),
  matches as (
    select u.id, r.id revision_id, to_tsvector('english'::regconfig, coalesce(r.title, '') || ' ' || r.content) doc
    from public.units u
    join public.revisions r on r.id = u.current_revision_id
    where u.retired_at is null
  )
  select m.id, m.revision_id,
         (cardinality(array(select unnest(tsvector_to_array(m.doc)) intersect select unnest(q.words))) + ts_rank_cd(m.doc, q.query, 32))::real
  from matches m cross join q
  where m.doc @@ q.query
  order by 3 desc, m.id
  limit p_limit
$$;
