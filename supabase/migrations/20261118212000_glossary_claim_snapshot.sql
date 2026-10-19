-- One consistent read replaces hundreds of sequential HTTP requests per scan.
-- A single JSON result also avoids the API's row cap for book-sized sources.
grant create on schema public to space_runtime;
create function public.glossary_claim_snapshot(p_unit_ids uuid[] default null) returns jsonb
language sql stable security definer set search_path='' set jit=off as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'revisionId',r.id,'text',r.content,
   'context',r.knowledge_context,'sourceEvidence',e.evidence) order by u.id),'[]')
 from public.units u join public.revisions r on r.id=u.current_revision_id
 cross join lateral (
   select jsonb_agg(jsonb_build_object('sourceId',p.source_id,'sourceTitle',coalesce(s.title,'Source'),'text',p.text) order by ids.position) evidence
   from unnest(r.passage_ids) with ordinality ids(id,position)
   join public.passages p on p.id=ids.id left join public.sources s on s.id=p.source_id
 ) e
 where u.retired_at is null and (p_unit_ids is null or u.id=any(p_unit_ids)) and e.evidence is not null
$$;
alter function public.glossary_claim_snapshot(uuid[]) owner to space_runtime;
revoke all on function public.glossary_claim_snapshot(uuid[]) from public,anon,authenticated;
grant execute on function public.glossary_claim_snapshot(uuid[]) to service_role;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
