-- Only count placements that the article renderer would currently show.
create function public.asset_article_usage() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p record; current_run jsonb; result jsonb := '[]'::jsonb;
begin
  for p in select distinct pages.id, pages.title, pages.slug
    from public.pages join public.composer_runs r on r.page_id=pages.id and r.active
    where pages.retired_at is null
  loop
    current_run := public.read_composer_run(p.id);
    result := result || coalesce((
      select jsonb_agg(jsonb_build_object('assetId', asset_id, 'pageId', p.id, 'title', p.title, 'slug', p.slug))
      from (select distinct coalesce(nullif(f->>'assetId', ''), g.asset_id::text) as asset_id
        from jsonb_array_elements(current_run->'composition'->'figures') f
        left join public.generated_asset_content g on nullif(f->>'svg', '') = g.svg
        where nullif(f->>'assetId', '') is not null or g.asset_id is not null) placements
    ), '[]'::jsonb);
  end loop;
  return result;
end $$;
revoke all on function public.asset_article_usage() from public, anon, authenticated;
grant execute on function public.asset_article_usage() to service_role;
notify pgrst, 'reload schema';
