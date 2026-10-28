-- The claim snapshot builds one JSON document for every live claim.
-- On a full space that takes about 8 seconds, which is the API statement limit,
-- so generation died before it could reuse saved groups.
-- The function gets its own longer limit, and it reads only the current space.

create or replace function public.glossary_claim_snapshot(p_unit_ids uuid[] default null) returns jsonb
language sql stable security definer set search_path='' set jit=off set statement_timeout='30s' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'revisionId',r.id,'text',r.content,
   'context',r.knowledge_context,'sourceEvidence',e.evidence) order by u.id),'[]')
 from public.units u join public.revisions r on r.id=u.current_revision_id
 cross join lateral (
   select jsonb_agg(jsonb_build_object('sourceId',p.source_id,'sourceTitle',coalesce(s.title,'Source'),'text',p.text) order by ids.position) evidence
   from unnest(r.passage_ids) with ordinality ids(id,position)
   join public.passages p on p.id=ids.id left join public.sources s on s.id=p.source_id
 ) e
 where u.retired_at is null and u.space_id=public.current_space_id()
   and (p_unit_ids is null or u.id=any(p_unit_ids)) and e.evidence is not null
$$;

alter function public.glossary_claim_snapshot(uuid[]) owner to space_runtime;
revoke all on function public.glossary_claim_snapshot(uuid[]) from public,anon,authenticated;
grant execute on function public.glossary_claim_snapshot(uuid[]) to service_role;
notify pgrst,'reload schema';
