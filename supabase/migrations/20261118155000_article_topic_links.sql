-- Link named concepts to the live sections that actually cover their claims.
-- Do not infer phrase destinations from embedding similarity alone.
create or replace function public.article_topic_links(p_page_id uuid)
returns jsonb language sql stable set search_path = '' as $$
with candidates as materialized (
  select s.id, s.page_id, s.title, s.query, p.slug, p.context_entity_id,
    root.context_entity_id root_context
  from public.pages root join public.pages p on p.id <> root.id
    and p.retired_at is null
    and (p.context_entity_id is null or p.context_entity_id = root.context_entity_id)
  join public.sections s on s.page_id = p.id and s.retired_at is null
  where root.id = p_page_id and root.retired_at is null
), membership as (
  select s.id section_id, u.id unit_id from candidates s
  join public.units u on coalesce(s.query->'unitIds','[]'::jsonb) ? u.id::text and u.retired_at is null
  union
  select s.id, u.id from candidates s
  join public.lines l on l.section_id = s.id and l.retired_at is null
  join public.line_revisions lr on lr.id = l.current_revision_id
  join public.revisions r on r.id = any(lr.unit_revision_ids)
  join public.units u on u.id = r.unit_id and u.retired_at is null
), scores as (
  select ue.entity_id, m.section_id, count(distinct m.unit_id) hits,
    count(distinct m.unit_id)::float8 / (select count(*) from membership all_m where all_m.section_id=m.section_id) density
  from membership m join public.unit_entities ue on ue.unit_id = m.unit_id and ue.role = 'subject'
  group by ue.entity_id, m.section_id
), best as (
  select distinct on (e.id) e.id, e.name, e.aliases, s.slug, s.id section_id
  from scores score join candidates s on s.id = score.section_id
  join public.entities e on e.id = score.entity_id and e.merged_into_id is null
  -- Generic organization mentions should resolve through the article-title linker.
  where e.type::text in ('concept','policy','procedure','document')
  order by e.id, (s.context_entity_id = s.root_context) desc nulls last,
    (lower(s.title) not in ('overview','introduction')) desc,
    score.density desc, score.hits desc, s.slug, s.id
), labels as (
  select distinct label, '/p/' || b.slug || '#section-' || b.section_id::text href
  from best b cross join lateral unnest(array_prepend(b.name,b.aliases)) label
  where length(btrim(label)) > 2
)
-- Ambiguous aliases are left as text, rather than silently picking a topic.
select coalesce(jsonb_agg(jsonb_build_object('label',label,'href',href)), '[]'::jsonb)
from labels l where not exists (
  select 1 from labels other where lower(other.label)=lower(l.label) and other.href<>l.href
);
$$;
revoke execute on function public.article_topic_links(uuid) from public, anon, authenticated;
grant execute on function public.article_topic_links(uuid) to service_role;
