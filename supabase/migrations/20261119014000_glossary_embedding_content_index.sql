-- OrioleDB rejects a valid same-workspace vector insert through this
-- non-unique secondary index and reports it as a unique violation.
-- The content hash remains on the row. The primary key already indexes
-- (space_id, entry_hash, model).
drop index if exists public.glossary_embeddings_content_idx;
notify pgrst,'reload schema';
