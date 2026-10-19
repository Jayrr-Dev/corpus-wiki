-- Knowledge cited by each live section of an article. One row per section and unit,
-- using the revision the section actually cites.
create view public.section_knowledge with (security_invoker = true) as
select sec.id as section_id,
  sec.page_id,
  sec.title as section_title,
  sec.position,
  u.id as unit_id,
  r.title as unit_title,
  r.content as unit_content
from public.sections sec
join public.pages pg on pg.id = sec.page_id and pg.retired_at is null and pg.article_type is not null
join public.section_inputs si on si.section_id = sec.id
join public.units u on u.id = si.unit_id and u.retired_at is null
join public.revisions r on r.id = si.revision_id
where sec.retired_at is null;

revoke all on public.section_knowledge from anon, authenticated;
grant select on public.section_knowledge to authenticated, service_role;
notify pgrst, 'reload schema';
