create table public.article_structure_plans (
 id uuid primary key default gen_random_uuid(),
 space_id uuid not null default public.current_space_id() references public.spaces(id) on delete cascade,
 page_id uuid not null,
 plan_key text not null,
 status text not null default 'planned' check(status in ('planned','applied','failed','superseded')),
 structure jsonb not null check(jsonb_typeof(structure)='array'),
 changes jsonb not null default '{}'::jsonb,
 rationale text not null default '',
 model_version text,
 created_at timestamptz not null default now(),
 applied_at timestamptz,
 foreign key(space_id,page_id) references public.pages(space_id,id) on delete cascade
);
create unique index article_structure_intent on public.article_structure_plans(space_id,page_id,plan_key) where status<>'failed';
create index article_structure_history on public.article_structure_plans(space_id,page_id,created_at desc);
alter table public.article_structure_plans enable row level security;
alter table public.article_structure_plans force row level security;
create policy space_server on public.article_structure_plans for all to space_runtime
 using(space_id=(select public.current_space_id())) with check(space_id=(select public.current_space_id()));
create policy space_browser_boundary on public.article_structure_plans for select to authenticated
 using(space_id=any(array(select unnest(public.readable_space_ids()))));
grant select on public.article_structure_plans to authenticated;
grant select,insert,update,delete on public.article_structure_plans to space_runtime;

create function public.read_article_structure(p_page_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'applied',(select to_jsonb(p) from public.article_structure_plans p where p.page_id=p_page_id and p.space_id=public.current_space_id() and p.status='applied' order by p.created_at desc,p.id desc limit 1),
  'planned',(select to_jsonb(p) from public.article_structure_plans p where p.page_id=p_page_id and p.space_id=public.current_space_id() and p.status='planned' order by p.created_at desc,p.id desc limit 1))
$$;
create function public.read_section_article_structure(p_section_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.read_article_structure(s.page_id) from public.sections s where s.id=p_section_id and s.space_id=public.current_space_id()
$$;
create function public.save_article_structure_plan(p_page_id uuid,p_plan_key text,p_structure jsonb,p_changes jsonb,p_rationale text,p_model_version text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not exists(select 1 from public.pages where id=p_page_id and space_id=public.current_space_id() and retired_at is null) then raise exception 'Article is unavailable in this space'; end if;
 if jsonb_typeof(p_structure) is distinct from 'array' then raise exception 'Invalid article structure'; end if;
 insert into public.article_structure_plans(page_id,plan_key,structure,changes,rationale,model_version)
 values(p_page_id,p_plan_key,p_structure,p_changes,coalesce(p_rationale,''),p_model_version)
 on conflict(space_id,page_id,plan_key) where status<>'failed' do update set plan_key=excluded.plan_key
 returning id into result;
 return result;
end $$;
create function public.finish_article_structure_plan(p_plan_id uuid,p_status text,p_structure jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.article_structure_plans;
begin
 if p_status not in ('applied','failed') then raise exception 'Invalid article structure status'; end if;
 if p_structure is not null and jsonb_typeof(p_structure) is distinct from 'array' then raise exception 'Invalid article structure'; end if;
 update public.article_structure_plans set status=p_status,structure=coalesce(p_structure,structure),applied_at=case when p_status='applied' then now() else null end
 where id=p_plan_id and space_id=public.current_space_id() returning * into result;
 if not found then raise exception 'Article structure plan is unavailable'; end if;
 if p_status='applied' then
  update public.article_structure_plans set status='superseded' where space_id=result.space_id and page_id=result.page_id and id<>result.id and status='planned' and created_at<=result.created_at;
 end if;
 return jsonb_build_object('id',result.id,'status',result.status);
end $$;
grant create on schema public to space_runtime;
alter function public.read_article_structure(uuid) owner to space_runtime;
alter function public.read_section_article_structure(uuid) owner to space_runtime;
alter function public.save_article_structure_plan(uuid,text,jsonb,jsonb,text,text) owner to space_runtime;
alter function public.finish_article_structure_plan(uuid,text,jsonb) owner to space_runtime;
revoke create on schema public from space_runtime;
revoke all on function public.read_article_structure(uuid),public.read_section_article_structure(uuid),public.save_article_structure_plan(uuid,text,jsonb,jsonb,text,text),public.finish_article_structure_plan(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.read_article_structure(uuid),public.read_section_article_structure(uuid),public.save_article_structure_plan(uuid,text,jsonb,jsonb,text,text),public.finish_article_structure_plan(uuid,text,jsonb) to service_role,space_runtime;
notify pgrst,'reload schema';
