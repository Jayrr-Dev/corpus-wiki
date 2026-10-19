-- Upload filing reads a consistent view of source context and the knowledge
-- already filed in candidate domains. Embeddings stay server-side.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.upload_unplaced_claims(uuid)'::regprocedure);
 definition:=replace(definition,'not exists (select 1 from public.unit_domains ud where ud.unit_id = u.id)',
  'not exists (select 1 from public.unit_domains ud join public.domains d on d.id=ud.domain_id where ud.unit_id=u.id and d.retired_at is null)');
 execute definition;
end $$;
create function public.upload_topic_context(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.upload_unplaced_claims(p_event_id) || jsonb_build_object(
  'sourceTitle',(select s.title from public.shift_events e join public.sources s on s.id=e.source_id where e.id=p_event_id),
  'sourceSections',coalesce((select jsonb_agg(jsonb_build_object('position',p.position,'location',p.location) order by p.position)
    from public.shift_events e join public.passages p on p.source_id=e.source_id where e.id=p_event_id),'[]'),
  'revisions',coalesce((select jsonb_agg(jsonb_build_object('unitId',u.id,'revisionId',u.current_revision_id))
    from public.units u where u.retired_at is null),'[]'),
  'evidence',coalesce((select jsonb_agg(jsonb_build_object('unitId',u.id,'passages',
    coalesce((select jsonb_agg(jsonb_build_object('location',p.location,'text',p.text) order by p.position)
      from public.passages p where p.id=any(r.passage_ids)),'[]')))
    from public.units u join public.revisions r on r.id=u.current_revision_id
    where u.retired_at is null and exists(select 1 from public.actions a join public.change_sets c on c.id=a.change_set_id
      where c.event_id=p_event_id and a.target_id=u.id and a.outcome='applied' and a.type::text in ('add_claim','revise_claim'))),'[]'),
  'snapshot',public.domain_review_snapshot(),
  'connections',public.domain_decider_connections(),
  'vectors',coalesce((select jsonb_agg(jsonb_build_object('revisionId',e.revision_id,'model',e.model,'embedding',e.embedding::text))
    from public.unit_embeddings e join public.units u on u.current_revision_id=e.revision_id where u.retired_at is null),'[]')
 );
$$;
revoke all on function public.upload_topic_context(uuid) from public,anon,authenticated;
grant execute on function public.upload_topic_context(uuid) to service_role;

-- A filing stage may finish only when every eligible claim has a live domain.
-- New roots still wait in the existing approval flow.
create function public.verify_upload_topic_coverage(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('unplaced',coalesce((
  select jsonb_agg(u.id order by u.id) from public.units u where u.retired_at is null
    and exists(select 1 from public.actions a join public.change_sets c on c.id=a.change_set_id
      where c.event_id=p_event_id and a.target_id=u.id and a.outcome='applied' and a.type::text in ('add_claim','revise_claim'))
    and not exists(select 1 from public.unit_domains m join public.domains d on d.id=m.domain_id where m.unit_id=u.id and d.retired_at is null)
 ),'[]'));
$$;
revoke all on function public.verify_upload_topic_coverage(uuid) from public,anon,authenticated;
grant execute on function public.verify_upload_topic_coverage(uuid) to service_role;

create function public.commit_upload_topics(p_change_set_id uuid,p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.change_sets; result jsonb;
begin
 lock table public.change_sets,public.actions,public.domains,public.unit_domains,public.units,public.revisions in share row exclusive mode;
 select * into saved from public.change_sets where id=p_change_set_id;
 if saved.id is null or saved.event_id is distinct from p_event_id then raise exception 'Upload filing was not found.'; end if;
 if saved.status in ('applied','partly_applied') then return change_control.commit_summary(saved.id,saved.status); end if;
 if exists(select 1 from public.actions a join public.units u on u.id=a.target_id
   where a.change_set_id=saved.id and a.type::text='place_claim' and
    (u.current_revision_id is distinct from a.expected_revision_id or u.retired_at is not null
     or exists(select 1 from public.unit_domains m join public.domains d on d.id=m.domain_id where m.unit_id=u.id and d.retired_at is null))) then
   raise exception 'Knowledge or its domain assignment changed during review. Retry filing.';
 end if;
 result:=public.commit_change_set(saved.id);
 if coalesce((result->>'rejected')::integer,0)>0 or result->>'status'='rejected' then
   raise exception 'Domain assignment failed validation. Nothing was filed.';
 end if;
 return result;
end $$;
revoke all on function public.commit_upload_topics(uuid,uuid) from public,anon,authenticated;
grant execute on function public.commit_upload_topics(uuid,uuid) to service_role;
