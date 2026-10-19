-- The current structure is derived from live article rows, never a second
-- editable copy. Versioned plans are advisory history and carry a freshness flag.
create function public.article_structure_snapshot(p_page_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'sectionId',s.id,'title',s.title,'position',s.position,
  'protected',s.mode<>'generated' or exists(select 1 from public.section_lines l where l.section_id=s.id and l.author='person'),
  'unitIds',coalesce(e.ids,'[]'::jsonb),'unitRevisions',coalesce(e.revisions,'[]'::jsonb),
  'lineRevisions',coalesce((select jsonb_agg(l.line_revision_id order by l.position,l.line_id) from public.section_lines l where l.section_id=s.id),'[]'::jsonb)
 ) order by s.position,s.id),'[]'::jsonb)
 from public.sections s
 left join lateral (
  select jsonb_agg(u.id order by u.id) ids,jsonb_agg(jsonb_build_array(u.id,u.current_revision_id) order by u.id) revisions
  from public.units u where u.id in(select public.living_page_query_units(s.query)) and u.space_id=s.space_id and u.retired_at is null
 ) e on true
 where s.page_id=p_page_id and s.space_id=public.current_space_id() and s.retired_at is null
$$;
alter table public.article_structure_plans add column basis_hash text;
create function public.stamp_article_structure_basis() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' or new.status='applied' then new.basis_hash:=md5(public.article_structure_snapshot(new.page_id)::text); end if;
 return new;
end $$;
create trigger stamp_article_structure_basis before insert or update of status on public.article_structure_plans
 for each row execute function public.stamp_article_structure_basis();

create or replace function public.read_article_structure(p_page_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with live as materialized(select public.article_structure_snapshot(p_page_id) value)
 select jsonb_build_object('current',live.value,
  'applied',(select to_jsonb(p)||jsonb_build_object('outOfDate',p.basis_hash is distinct from md5(live.value::text)) from public.article_structure_plans p where p.page_id=p_page_id and p.space_id=public.current_space_id() and p.status='applied' order by p.created_at desc,p.id desc limit 1),
  'planned',(select to_jsonb(p)||jsonb_build_object('outOfDate',p.basis_hash is distinct from md5(live.value::text)) from public.article_structure_plans p where p.page_id=p_page_id and p.space_id=public.current_space_id() and p.status='planned' order by p.created_at desc,p.id desc limit 1)) from live
$$;
grant create on schema public to space_runtime;
alter function public.article_structure_snapshot(uuid) owner to space_runtime;
revoke create on schema public from space_runtime;
revoke all on function public.article_structure_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.article_structure_snapshot(uuid) to service_role,space_runtime;
notify pgrst,'reload schema';
