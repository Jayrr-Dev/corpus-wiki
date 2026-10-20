-- A claim is placed once a live article section selects it or cites it.
-- Selecting it maps unused knowledge onto the article without a rewrite.

create or replace view public.section_knowledge with (security_invoker = true) as
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
where sec.retired_at is null
union
select sec.id,
  sec.page_id,
  sec.title,
  sec.position,
  u.id,
  r.title,
  r.content
from public.sections sec
join public.pages pg on pg.id = sec.page_id and pg.retired_at is null and pg.article_type is not null
cross join lateral jsonb_array_elements_text(sec.query -> 'unitIds') listed(unit_id)
join public.units u on u.id = listed.unit_id::uuid and u.retired_at is null
join public.revisions r on r.id = u.current_revision_id
where sec.retired_at is null
  and jsonb_typeof(sec.query -> 'unitIds') = 'array'
  and not exists (
    select 1 from public.section_inputs si
    where si.section_id = sec.id and si.unit_id = u.id
  );

create or replace view public.article_knowledge with (security_invoker = true) as
select pg.id as page_id,
  pg.title,
  pg.slug,
  pg.article_type,
  count(distinct placed.unit_id)::int as unit_count
from public.pages pg
left join public.sections sec on sec.page_id = pg.id and sec.retired_at is null
left join lateral (
  select si.unit_id
  from public.section_inputs si
  join public.units u on u.id = si.unit_id and u.retired_at is null
  where si.section_id = sec.id
  union
  select u.id
  from jsonb_array_elements_text(case when jsonb_typeof(sec.query -> 'unitIds') = 'array' then sec.query -> 'unitIds' else '[]'::jsonb end) listed(unit_id)
  join public.units u on u.id = listed.unit_id::uuid and u.retired_at is null
) placed on true
where pg.retired_at is null and pg.article_type is not null
group by pg.id, pg.title, pg.slug, pg.article_type;

create or replace view public.knowledge_usage with (security_invoker = true) as
select
  (select count(*)::int from public.units u where u.retired_at is null) as unit_count,
  (select count(distinct placed.unit_id)::int from (
    select si.unit_id
    from public.section_inputs si
    join public.units u on u.id = si.unit_id and u.retired_at is null
    join public.sections sec on sec.id = si.section_id and sec.retired_at is null
    join public.pages pg on pg.id = sec.page_id and pg.retired_at is null and pg.article_type is not null
    union
    select u.id
    from public.sections sec
    join public.pages pg on pg.id = sec.page_id and pg.retired_at is null and pg.article_type is not null
    cross join lateral jsonb_array_elements_text(sec.query -> 'unitIds') listed(unit_id)
    join public.units u on u.id = listed.unit_id::uuid and u.retired_at is null
    where sec.retired_at is null and jsonb_typeof(sec.query -> 'unitIds') = 'array'
  ) placed) as used_unit_count;

grant select on public.section_knowledge to authenticated, service_role, space_runtime;
grant select on public.article_knowledge, public.knowledge_usage to authenticated, service_role;
notify pgrst, 'reload schema';
