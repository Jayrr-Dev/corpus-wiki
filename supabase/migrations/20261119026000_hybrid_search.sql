-- =====================================================================
-- SECOND BRAIN · HYBRID CHAT SEARCH
-- =====================================================================
-- Two extra ways for chat to find claims, fused with meaning search
-- (similar_units) in TypeScript: ranked keyword search and one hop over links.
-- No index: the claim sets are small and OrioleDB only bridges GIN (AGENTS.md).
-- =====================================================================

grant create on schema public to space_runtime;

-- KEYWORD SEARCH: live claims whose current wording matches, best first
create function public.search_units_text(p_query text, p_limit integer default 40)
returns table (unit_id uuid, revision_id uuid, rank real)
language sql stable
set search_path = ''
as $$
  with q as (select websearch_to_tsquery('english'::regconfig, coalesce(p_query, '')) query),
  matches as (
    select u.id, r.id revision_id, to_tsvector('english'::regconfig, coalesce(r.title, '') || ' ' || r.content) doc
    from public.units u
    join public.revisions r on r.id = u.current_revision_id
    where u.retired_at is null
  )
  select m.id, m.revision_id, ts_rank_cd(m.doc, q.query)
  from matches m cross join q
  where m.doc @@ q.query
  order by 3 desc, m.id
  limit p_limit
$$;

-- LINK SEARCH: live claims one live link away from the seeds, either direction;
-- each claim once, reached through the earliest seed in the array
create function public.linked_units(p_unit_ids uuid[], p_limit integer default 20)
returns table (unit_id uuid, via_unit_id uuid, type text)
language sql stable
set search_path = ''
as $$
  with hops as (
    select l.to_unit_id unit_id, l.from_unit_id via_unit_id, l.type
    from public.relationships l
    where l.from_unit_id = any(p_unit_ids) and l.retired_at is null
    union all
    select l.from_unit_id, l.to_unit_id, l.type
    from public.relationships l
    where l.to_unit_id = any(p_unit_ids) and l.retired_at is null
  ),
  best as (
    select distinct on (h.unit_id) h.unit_id, h.via_unit_id, h.type, array_position(p_unit_ids, h.via_unit_id) seed
    from hops h
    join public.units u on u.id = h.unit_id and u.retired_at is null
    join public.units v on v.id = h.via_unit_id and v.retired_at is null
    where array_position(p_unit_ids, h.unit_id) is null
    order by h.unit_id, seed, h.type, h.via_unit_id
  )
  select b.unit_id, b.via_unit_id, b.type::text
  from best b
  order by b.seed, b.unit_id
  limit p_limit
$$;

alter function public.search_units_text(text, integer) owner to space_runtime;
alter function public.linked_units(uuid[], integer) owner to space_runtime;
revoke execute on function public.search_units_text(text, integer) from public, anon, authenticated;
revoke execute on function public.linked_units(uuid[], integer) from public, anon, authenticated;
grant execute on function public.search_units_text(text, integer) to service_role, space_runtime;
grant execute on function public.linked_units(uuid[], integer) to service_role, space_runtime;

revoke create on schema public from space_runtime;
