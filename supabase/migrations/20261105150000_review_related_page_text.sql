create or replace function public.page_review_related(p_revision_ids uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('unitId',u.id,'revisionId',r.id,'content',r.content,'epistemicStatus',u.epistemic_status,
 'passages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'text',p.text,'sourceId',p.source_id)) from public.passages p where p.id=any(r.passage_ids)),'[]'),
 'pages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'slug',p.slug,'content',coalesce((select string_agg(sl.content,E'\n' order by ps.position,sl.position) from public.sections ps join public.section_lines sl on sl.section_id=ps.id where ps.page_id=p.id and ps.retired_at is null),''))) from public.pages p where p.retired_at is null and p.id in (
   select s.page_id from public.sections s join public.section_lines l on l.section_id=s.id where s.retired_at is null and r.id=any(l.unit_revision_ids))),'[]')) order by u.id),'[]')
 from public.units u join public.revisions r on r.id=u.current_revision_id where u.retired_at is null and r.id=any(p_revision_ids);
$$;
