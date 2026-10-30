-- PAGE REVIEW STATE: whether an article's current content was already reviewed,
-- so a post-rebuild review is skipped instead of resending identical input.
-- current: the latest completed review saw exactly this content.
-- partialRuns: partial reviews of exactly this content (a partial review is
-- stored as 'partial:'||hash); identical input gives the same partial result.
-- unfinishedSections: sections still waiting to be written.
create function public.page_review_state(p_page_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with hash as (select public.page_review_content_hash(p_page_id) as value)
 select jsonb_build_object(
  'current',coalesce((select r.snapshot_hash=h.value from public.page_review_runs r where r.page_id=p_page_id order by r.created_at desc limit 1),false),
  'partialRuns',(select count(*) from public.page_review_runs r where r.page_id=p_page_id and r.snapshot_hash='partial:'||h.value),
  'unfinishedSections',(select count(*) from public.sections s where s.page_id=p_page_id and s.retired_at is null and s.status<>'current'))
 from hash h
$$;
grant create on schema public to space_runtime;
alter function public.page_review_state(uuid) owner to space_runtime;
revoke create on schema public from space_runtime;
revoke all on function public.page_review_state(uuid) from public,anon,authenticated;
grant execute on function public.page_review_state(uuid) to service_role,space_runtime;
notify pgrst,'reload schema';
