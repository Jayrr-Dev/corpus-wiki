-- =====================================================================
-- SECOND BRAIN · UNIT VECTORS
-- =====================================================================
-- Reads saved claim vectors back (as "[...]" text), so the cleaning cycle
-- can compare every pair of claims it loads. Server only.
-- =====================================================================

create or replace function public.unit_vectors(p_model text, p_revision_ids uuid[])
returns table (revision_id uuid, embedding text)
language sql stable
set search_path = ''
as $$
  select e.revision_id, e.embedding::text
  from public.unit_embeddings e
  where e.model = p_model and e.revision_id = any (p_revision_ids)
$$;

revoke execute on function public.unit_vectors(text, uuid[]) from public, anon, authenticated;
grant execute on function public.unit_vectors(text, uuid[]) to service_role;
