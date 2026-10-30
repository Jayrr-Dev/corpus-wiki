-- stale_unit_embeddings (20261125100000) was granted to service_role only, but uploads call it
-- as space_runtime: indexing failed with "permission denied" and duplicates fell back to words.
-- It is not security definer, so the space boundary still applies to what it reads.
grant execute on function public.stale_unit_embeddings(text, integer, integer) to space_runtime;
