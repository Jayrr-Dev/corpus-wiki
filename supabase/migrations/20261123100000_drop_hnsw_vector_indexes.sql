-- =====================================================================
-- SECOND BRAIN · EXACT VECTOR SEARCH (drop the HNSW indexes)
-- =====================================================================
-- unit_embeddings and glossary_embeddings had HNSW indexes. On OrioleDB
-- only B-tree indexes are native; others go through an experimental
-- bridge that has dropped connections and hidden inserted rows here
-- (AGENTS.md, Database rules). HNSW also applies the WHERE filters
-- (model, minimum similarity) after its index search, so a filtered
-- query can quietly return fewer matches than its limit.
--
-- The stores are small, so exact search (a scan ordered by cosine
-- distance) is fast and always complete. passage_embeddings already has
-- no vector index. Revisit only when measured latency requires it.
-- =====================================================================

drop index if exists public.unit_embeddings_vector_idx;
drop index if exists public.glossary_embeddings_vector_idx;
