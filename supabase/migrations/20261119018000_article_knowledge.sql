-- How much live knowledge an article uses, and how much of the space's
-- knowledge is in any article. security_invoker so space RLS still applies.
create view public.article_knowledge with (security_invoker = true) as
select pg.id as page_id,
  pg.title,
  pg.slug,
  pg.article_type,
  count(distinct si.unit_id)::int as unit_count
from public.pages pg
left join public.sections sec on sec.page_id = pg.id and sec.retired_at is null
left join public.section_inputs si on si.section_id = sec.id
left join public.units u on u.id = si.unit_id and u.retired_at is null
where pg.retired_at is null and pg.article_type is not null
group by pg.id, pg.title, pg.slug, pg.article_type;

create view public.knowledge_usage with (security_invoker = true) as
select
  (select count(*)::int from public.units u where u.retired_at is null) as unit_count,
  (select count(distinct si.unit_id)::int
   from public.section_inputs si
   join public.units u on u.id = si.unit_id and u.retired_at is null
   join public.sections sec on sec.id = si.section_id and sec.retired_at is null
   join public.pages pg on pg.id = sec.page_id and pg.retired_at is null and pg.article_type is not null
  ) as used_unit_count;

revoke all on public.article_knowledge, public.knowledge_usage from anon, authenticated;
grant select on public.article_knowledge, public.knowledge_usage to authenticated, service_role;
notify pgrst, 'reload schema';
