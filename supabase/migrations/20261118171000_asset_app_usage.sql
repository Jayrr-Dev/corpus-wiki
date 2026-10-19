-- Logical destinations across the app, including the evidence thumbnails
-- shared by knowledge detail / graph previews and article / main-page previews.
create function public.asset_app_usage() returns jsonb
language sql stable security definer set search_path = public as $$
  with asset_passages as (
    select a.id as asset_id, pa.id as passage_id
    from public.assets a join public.passages pa on pa.source_id=a.source_id
    join public.sources src on src.id=a.source_id
    where (pa.location->>'figure'=a.storage_path)
      or (a.storage_path not like 'figures/%' and src.mime_type ~ '^(image|video|audio)/')
  ), placements as (
    select x->>'assetId' as asset_id, 'article'::text as kind,
      x->>'title' as title, '/p/'||(x->>'slug') as href
    from jsonb_array_elements(public.asset_article_usage()) x
    union
    select a.id::text, 'source', src.title, '/sources/'||src.id
    from public.assets a join public.sources src on src.id=a.source_id
    union
    select ap.asset_id::text, 'knowledge', coalesce(nullif(current_r.title,''), left(current_r.content,100)), '/units/'||u.id
    from asset_passages ap join public.revisions r on ap.passage_id=any(r.passage_ids)
    join public.units u on u.id=r.unit_id and u.retired_at is null
    join public.revisions current_r on current_r.id=u.current_revision_id
    union
    select ap.asset_id::text, 'article', p.title, '/p/'||p.slug
    from asset_passages ap join public.revisions r on ap.passage_id=any(r.passage_ids)
    join public.line_revisions lr on r.id=any(lr.unit_revision_ids)
    join public.lines l on l.current_revision_id=lr.id and l.retired_at is null
    join public.sections s on s.id=l.section_id and s.retired_at is null
    join public.pages p on p.id=s.page_id and p.retired_at is null
    union
    select a.id::text, 'stakeholder', e.name, '/stakeholders/'||e.id
    from public.assets a join public.entity_profiles ep on ep.logo_url=a.media_url
      or ep.logo_url='/api/assets/'||a.id||'/image'
      or ep.logo_url='/api/assets/'||a.id||'/vector'
      or ep.logo_url='/api/assets/'||a.id||'/generated'
      or ep.logo_url='/api/sources/'||a.source_id||'/file'
    join public.entities e on e.id=ep.entity_id and e.retired_at is null
    where not ep.hidden and ep.is_stakeholder
  )
  select coalesce(jsonb_agg(jsonb_build_object('assetId',asset_id,'kind',kind,'title',title,'href',href)
    order by kind,title,href),'[]'::jsonb) from placements;
$$;
revoke all on function public.asset_app_usage() from public, anon, authenticated;
grant execute on function public.asset_app_usage() to service_role;
notify pgrst, 'reload schema';
