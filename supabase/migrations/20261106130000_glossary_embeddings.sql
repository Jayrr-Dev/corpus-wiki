create table public.glossary_embeddings (
 entry_hash text not null, model text not null, entry jsonb not null,
 embedding extensions.vector(1024) not null, created_at timestamptz not null default now(),
 primary key(entry_hash,model)
);
create index glossary_embeddings_vector_idx on public.glossary_embeddings using hnsw(embedding extensions.vector_cosine_ops);
alter table public.glossary_embeddings enable row level security;
grant all on public.glossary_embeddings to service_role;

create function public.missing_glossary_embeddings(p_model text,p_limit integer default 64) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(entry),'[]') from (
 select e.value as entry from public.glossary_state s cross join lateral jsonb_array_elements(s.entries) e
 where s.id and not exists(select 1 from public.glossary_embeddings v where v.model=p_model and v.entry=e.value)
 limit greatest(1,least(p_limit,256))) candidates;
$$;

create function public.save_glossary_embeddings(p_rows jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare saved integer;
begin
 insert into public.glossary_embeddings(entry_hash,model,entry,embedding)
 select r->>'hash',r->>'model',r->'entry',(r->>'embedding')::extensions.vector(1024)
 from jsonb_array_elements(p_rows) r where exists(select 1 from public.glossary_state s,
 lateral jsonb_array_elements(s.entries) e where s.id and e.value=r->'entry')
 on conflict(entry_hash,model) do update set entry=excluded.entry,embedding=excluded.embedding;
 get diagnostics saved=row_count;
 return saved;
end $$;

create function public.search_glossary(p_model text,p_embedding text,p_limit integer default 8,p_min double precision default 0.35)
returns table(entry jsonb,similarity double precision)
language sql stable security definer set search_path='' as $$
 select v.entry,1-(v.embedding operator(extensions.<=>) p_embedding::extensions.vector(1024)) similarity
 from public.glossary_embeddings v
 where v.model=p_model and exists(select 1 from public.glossary_state s,
 lateral jsonb_array_elements(s.entries) e where s.id and e.value=v.entry)
 and 1-(v.embedding operator(extensions.<=>) p_embedding::extensions.vector(1024))>=p_min
 order by v.embedding operator(extensions.<=>) p_embedding::extensions.vector(1024)
 limit greatest(1,least(p_limit,32));
$$;
revoke all on function public.missing_glossary_embeddings(text,integer) from public,anon,authenticated;
revoke all on function public.save_glossary_embeddings(jsonb) from public,anon,authenticated;
revoke all on function public.search_glossary(text,text,integer,double precision) from public,anon,authenticated;
grant execute on function public.missing_glossary_embeddings(text,integer) to service_role;
grant execute on function public.save_glossary_embeddings(jsonb) to service_role;
grant execute on function public.search_glossary(text,text,integer,double precision) to service_role;
notify pgrst,'reload schema';
