-- Distinct live knowledge units from a file that a live article section cites.
-- Append the column without changing the existing usage metrics.
do $$ declare definition text; begin
 definition:=regexp_replace(pg_get_viewdef('public.source_usage'::regclass,true),';[[:space:]]*$','');
 execute 'create or replace view public.source_usage with (security_invoker=true) as
  select usage.*,(
   select count(distinct su.unit_id)
   from public.source_units su
   join public.units u on u.id=su.unit_id
   join public.section_inputs si on si.unit_id=su.unit_id
   join public.sections sec on sec.id=si.section_id
   join public.pages pg on pg.id=sec.page_id
   where su.source_id=usage.source_id and u.retired_at is null
    and sec.retired_at is null and pg.retired_at is null
  )::int used_unit_count from ('||definition||') usage';
end $$;
notify pgrst,'reload schema';
