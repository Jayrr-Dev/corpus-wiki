-- =====================================================================
-- SECOND BRAIN · SOURCE USAGE · LINES
-- =====================================================================
-- Adds line_count to source_usage: how many live article lines state a
-- claim drawn from the file. A line counts when any unit revision it
-- cites quotes a passage of the file, on a live section of a live page.
-- =====================================================================

create or replace view public.source_usage with (security_invoker = true) as
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
  )::int as article_count,
  (
    select count(distinct l.id)
    from public.passages p
    join public.revisions r on p.id = any (r.passage_ids)
    join public.line_revisions lr on r.id = any (lr.unit_revision_ids)
    join public.lines l on l.current_revision_id = lr.id
    join public.sections sec on sec.id = l.section_id
    join public.pages pg on pg.id = sec.page_id
    where p.source_id = s.id and l.retired_at is null
      and sec.retired_at is null and pg.retired_at is null
  )::int as line_count
from public.sources s;
