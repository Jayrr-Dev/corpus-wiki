CREATE OR REPLACE FUNCTION public.save_glossary_embeddings(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare saved integer;
begin
 insert into public.glossary_embeddings(entry_hash,model,entry,embedding)
 select r->>'hash',r->>'model',r->'entry',(r->>'embedding')::extensions.vector(1024)
 from jsonb_array_elements(p_rows) r where exists(select 1 from public.glossary_state s,
 lateral jsonb_array_elements(s.entries) e where s.id and e.value=r->'entry')
 on conflict (space_id, entry_hash,model) do update set entry=excluded.entry,embedding=excluded.embedding;
 get diagnostics saved=row_count;
 return saved;
end $function$
