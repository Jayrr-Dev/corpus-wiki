-- =====================================================================
-- SECOND BRAIN · SOURCE USAGE
-- =====================================================================
-- The Sources list shows, per file, how much current knowledge cites it
-- and how many articles that knowledge appears in. Counted here so the
-- list reads one row per file instead of walking the links itself.
--   unit_count     live units whose current revision cites the file
--   article_count  live pages with a live section built from those units
-- =====================================================================

create view public.source_usage with (security_invoker = true) as
select s.id as source_id,
  (
    select count(distinct su.unit_id)
    from public.source_units su
    join public.units u on u.id = su.unit_id
    where su.source_id = s.id and u.retired_at is null
  )::int as unit_count,
  (
    select count(distinct pg.id)
    from public.source_units su
    join public.units u on u.id = su.unit_id
    join public.section_inputs si on si.unit_id = su.unit_id
    join public.sections sec on sec.id = si.section_id
    join public.pages pg on pg.id = sec.page_id
    where su.source_id = s.id and u.retired_at is null
      and sec.retired_at is null and pg.retired_at is null
  )::int as article_count
from public.sources s;

revoke all on public.source_usage from anon, authenticated;
grant select on public.source_usage to authenticated, service_role;
