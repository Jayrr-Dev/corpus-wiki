-- Finding unpublished vectors used to compare each saved embedding document
-- with every dictionary entry. OrioleDB drops the connection while detoasting
-- those copies, and PostgREST then reports a schema-cache failure.
-- Store one hash of the canonical entry and look that up instead.
grant create on schema public to space_runtime;
alter table public.glossary_embeddings add column content_key text;

create function public.glossary_embedding_key(p_entry jsonb) returns text
language sql immutable strict parallel safe set search_path='' as $$
  select md5(p_entry::text)
$$;
revoke all on function public.glossary_embedding_key(jsonb) from public,anon,authenticated;
grant execute on function public.glossary_embedding_key(jsonb) to service_role,space_runtime;
alter function public.glossary_embedding_key(jsonb) owner to space_runtime;

do $$
declare updated integer;
begin
  loop
    update public.glossary_embeddings as target
    set content_key=public.glossary_embedding_key(target.entry)
    where target.content_key is null
      and (target.space_id,target.entry_hash,target.model) in (
        select space_id,entry_hash,model from public.glossary_embeddings where content_key is null limit 100
      );
    get diagnostics updated=row_count;
    exit when updated=0;
  end loop;
end $$;

-- No secondary btree here. OrioleDB reports a false unique violation on the
-- next same-workspace vector insert through one, as it did for space_idx.

create or replace function public.missing_glossary_embeddings(p_model text,p_limit integer default 64) returns jsonb
language sql stable security definer set search_path='' set jit=off as $$
  select coalesce(jsonb_agg(candidate.entry),'[]') from (
    select e.value as entry
    from public.glossary_state s
    cross join lateral jsonb_array_elements(s.entries) e
    where s.id and not exists(
      select 1 from public.glossary_embeddings v
      where v.model=p_model and v.content_key=public.glossary_embedding_key(e.value))
    limit greatest(1,least(p_limit,64))) candidate;
$$;

create or replace function public.save_glossary_embeddings(p_rows jsonb) returns integer
language plpgsql security definer set search_path='' set jit=off as $$
declare saved integer;
begin
  insert into public.glossary_embeddings(entry_hash,model,entry,embedding,content_key)
  select r->>'hash',r->>'model',r->'entry',(r->>'embedding')::extensions.vector(1024),public.glossary_embedding_key(r->'entry')
  from jsonb_array_elements(p_rows) r
  where exists(
    select 1 from public.glossary_state s
    cross join lateral jsonb_array_elements(s.entries) e
    where s.id and public.glossary_embedding_key(e.value)=public.glossary_embedding_key(r->'entry'))
  on conflict(space_id,entry_hash,model) do update
  set entry=excluded.entry,embedding=excluded.embedding,content_key=excluded.content_key;
  get diagnostics saved=row_count;
  return saved;
end $$;

create or replace function public.search_glossary(p_model text,p_embedding text,p_limit integer default 8,p_min double precision default 0.35)
returns table(entry jsonb,similarity double precision)
language sql stable security definer set search_path='' set jit=off as $$
  select v.entry,1-(v.embedding operator(extensions.<=>) p_embedding::extensions.vector(1024)) similarity
  from public.glossary_state s
  cross join lateral jsonb_array_elements(s.entries) e
  join public.glossary_embeddings v on v.model=p_model and v.content_key=public.glossary_embedding_key(e.value)
  where s.id and 1-(v.embedding operator(extensions.<=>) p_embedding::extensions.vector(1024))>=p_min
  order by v.embedding operator(extensions.<=>) p_embedding::extensions.vector(1024)
  limit greatest(1,least(p_limit,32));
$$;

alter function public.missing_glossary_embeddings(text,integer) owner to space_runtime;
alter function public.save_glossary_embeddings(jsonb) owner to space_runtime;
alter function public.search_glossary(text,text,integer,double precision) owner to space_runtime;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
