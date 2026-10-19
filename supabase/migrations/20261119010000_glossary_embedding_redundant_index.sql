-- OrioleDB rejects valid same-space vector inserts through this redundant
-- secondary index. A rollback probe succeeds when only this index is absent.
-- The primary key already indexes (space_id,entry_hash,model).
do $$
begin
  if to_regclass('public.glossary_embeddings_space_idx') is null then return; end if;
  if exists(select 1 from pg_index where indexrelid='public.glossary_embeddings_space_idx'::regclass and indisunique) then
    raise exception 'Workspace index unexpectedly enforces uniqueness';
  end if;
  if not exists(
    select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
    where i.indrelid='public.glossary_embeddings'::regclass and i.indisprimary and a.attname='space_id'
  ) then raise exception 'Workspace-prefixed primary index is required'; end if;
  drop index public.glossary_embeddings_space_idx;
end $$;
notify pgrst,'reload schema';
