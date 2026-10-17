-- Compact recommendation inputs. Vectors remain in Postgres; no new indexes
-- (including non-B-tree indexes) or embedding-provider calls are required.
create or replace function public.related_article_signals(p_page_id uuid)
returns jsonb language sql stable set search_path = '' as $$
with eligible as materialized (
  select p.* from public.pages p
  join public.pages root on root.id = p_page_id and root.retired_at is null
  where p.retired_at is null
    and (p.context_entity_id is null or p.context_entity_id = root.context_entity_id)
), sections as materialized (
  select s.* from public.sections s join eligible p on p.id = s.page_id where s.retired_at is null
), membership as materialized (
  -- Use actual citations as well as declared section scope; deduplicate claims.
  select distinct s.page_id, u.id unit_id, u.current_revision_id
  from sections s
  join public.lines l on l.section_id = s.id and l.retired_at is null
  join public.line_revisions lr on lr.id = l.current_revision_id
  join public.revisions r on r.id = any(lr.unit_revision_ids)
  join public.units u on u.id = r.unit_id and u.retired_at is null
  union
  select s.page_id, u.id, u.current_revision_id from sections s
  join public.units u on coalesce(s.query->'unitIds', '[]'::jsonb) ? u.id::text and u.retired_at is null
), centroids as materialized (
  select m.page_id, e.model, extensions.avg(e.embedding) embedding, count(*) coverage
  from membership m join public.unit_embeddings e on e.revision_id = m.current_revision_id
  group by m.page_id, e.model
), similarities as (
  -- Never compare vectors from different models. Prefer the model with the
  -- greatest coverage in this article if a model migration is in progress.
  select distinct on (b.page_id) b.page_id id,
    1 - (a.embedding operator(extensions.<=>) b.embedding) similarity
  from centroids a join centroids b on b.model = a.model and b.page_id <> a.page_id
  where a.page_id = p_page_id
    and extensions.vector_norm(a.embedding) > 0 and extensions.vector_norm(b.embedding) > 0
  order by b.page_id, a.coverage desc, b.coverage desc, a.model
), edges as (
  select a.page_id as source, b.page_id as target, count(*)::float8 weight
  from membership a join public.relationships r on r.from_unit_id = a.unit_id and r.retired_at is null
  join membership b on b.unit_id = r.to_unit_id and b.page_id <> a.page_id
  group by a.page_id, b.page_id
  union all
  select a.page_id, b.page_id, count(*)::float8 from membership a
  join membership b on b.unit_id = a.unit_id and a.page_id < b.page_id
  group by a.page_id, b.page_id
)
select jsonb_build_object(
  'pages', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'slug', slug,
    'entity_id', entity_id, 'domain_id', domain_id, 'context_entity_id', context_entity_id, 'parent_page_id', parent_page_id)) from eligible), '[]'::jsonb),
  'sections', coalesce((select jsonb_agg(jsonb_build_object('page_id', page_id, 'query', query)) from sections), '[]'::jsonb),
  'text', coalesce((select string_agg(lr.content, ' ') from sections s
    join public.lines l on l.section_id = s.id and l.retired_at is null
    join public.line_revisions lr on lr.id = l.current_revision_id where s.page_id = p_page_id), ''),
  'connections', coalesce((select jsonb_agg(jsonb_build_object('from', source, 'to', target, 'weight', ln(1 + weight))) from edges), '[]'::jsonb),
  'similarities', coalesce((select jsonb_agg(to_jsonb(s)) from similarities s), '[]'::jsonb)
);
$$;
revoke execute on function public.related_article_signals(uuid) from public, anon, authenticated;
grant execute on function public.related_article_signals(uuid) to service_role;
