-- =====================================================================
-- SECOND BRAIN · SAVE UNIT EMBEDDINGS WITHOUT ON CONFLICT
-- =====================================================================
-- On this project's pgvector, an INSERT ... ON CONFLICT into a table with
-- an HNSW index fails with a false "duplicate key ... unit_embeddings_unit_idx"
-- (a plain INSERT works). A saved vector is replaced by delete + insert.
-- =====================================================================

create or replace function public.save_unit_embeddings(p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_saved integer;
begin
  delete from public.unit_embeddings e
  using jsonb_array_elements(p_rows) x
  where e.revision_id = (x ->> 'revisionId')::uuid;
  insert into public.unit_embeddings (revision_id, unit_id, model, embedding)
  select distinct on ((x ->> 'revisionId')::uuid)
    (x ->> 'revisionId')::uuid, (x ->> 'unitId')::uuid, x ->> 'model', (x -> 'embedding')::text::extensions.vector
  from jsonb_array_elements(p_rows) x;
  get diagnostics v_saved = row_count;
  return v_saved;
end $$;

revoke execute on function public.save_unit_embeddings(jsonb) from public, anon, authenticated;
grant execute on function public.save_unit_embeddings(jsonb) to service_role;
