-- Count distinct live sections using the same source-backed inputs as Articles.
-- Append the column without changing the existing usage metrics or RLS behavior.
do $$ declare definition text; begin
 definition:=regexp_replace(pg_get_viewdef('public.source_usage'::regclass,true),';[[:space:]]*$','');
 execute 'create or replace view public.source_usage with (security_invoker=true) as
  select usage.*,(
   select count(distinct sec.id)
   from public.source_units su
   join public.units u on u.id=su.unit_id
   join public.section_inputs si on si.unit_id=su.unit_id
   join public.sections sec on sec.id=si.section_id
   join public.pages pg on pg.id=sec.page_id
   where su.source_id=usage.source_id and u.retired_at is null
    and sec.retired_at is null and pg.retired_at is null
  )::int section_count from ('||definition||') usage';
end $$;
notify pgrst,'reload schema';
