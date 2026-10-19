-- A 64-row save hashed every dictionary entry once per vector, so the
-- statement exceeded the 8 second request limit. Hash the live dictionary
-- once, then match the incoming rows against that set.
grant create on schema public to space_runtime;
create or replace function public.save_glossary_embeddings(p_rows jsonb) returns integer
language plpgsql security definer set search_path='' set jit=off as $$
declare saved integer;
begin
  with live as materialized (
    select public.glossary_embedding_key(e.value) as content_key
    from public.glossary_state s
    cross join lateral jsonb_array_elements(s.entries) e
    where s.id
  ), incoming as (
    select r->>'hash' as hash, r->>'model' as model, r->'entry' as entry,
      (r->>'embedding')::extensions.vector(1024) as embedding,
      public.glossary_embedding_key(r->'entry') as content_key
    from jsonb_array_elements(p_rows) r
  )
  insert into public.glossary_embeddings(entry_hash,model,entry,embedding,content_key)
  select incoming.hash, incoming.model, incoming.entry, incoming.embedding, incoming.content_key
  from incoming
  where incoming.content_key in (select live.content_key from live)
  on conflict(space_id,entry_hash,model) do update
  set entry=excluded.entry,embedding=excluded.embedding,content_key=excluded.content_key;
  get diagnostics saved=row_count;
  return saved;
end $$;
alter function public.save_glossary_embeddings(jsonb) owner to space_runtime;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
