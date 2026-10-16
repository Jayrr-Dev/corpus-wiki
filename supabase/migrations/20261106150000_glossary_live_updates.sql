do $$ declare table_name text;
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
   foreach table_name in array array['units','change_sets','actions'] loop
     if not exists(select 1 from pg_publication_tables p where p.pubname='supabase_realtime' and p.schemaname='public' and p.tablename=table_name) then
       execute format('alter publication supabase_realtime add table public.%I',table_name);
     end if;
   end loop;
 end if;
end $$;
