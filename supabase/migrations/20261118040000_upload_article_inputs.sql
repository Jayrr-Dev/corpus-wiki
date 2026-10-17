-- An event touches catalog rows and article lines as well as knowledge units.
-- Record only live unit revisions when deciding whether enrichment needs a
-- second article pass; writing the first page is not new knowledge.
create function public.upload_article_inputs(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('unitId',u.id,'revisionId',u.current_revision_id) order by u.id),'[]'::jsonb)
  from public.units u
  where u.retired_at is null and u.id in (select public.living_page_event_units(p_event_id))
$$;
revoke all on function public.upload_article_inputs(uuid) from public,anon,authenticated;
grant execute on function public.upload_article_inputs(uuid) to service_role;
notify pgrst,'reload schema';
