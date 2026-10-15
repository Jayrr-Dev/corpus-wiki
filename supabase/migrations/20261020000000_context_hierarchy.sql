-- Context belongs to a real entity; topics remain a reusable taxonomy.
alter table public.domains add column context_entity_id uuid references public.entities(id);
alter table public.pages add column context_entity_id uuid references public.entities(id);
alter table public.pages add column parent_page_id uuid references public.pages(id);
alter table public.pages add constraint pages_not_own_parent check (parent_page_id is distinct from id);
create index domains_context_idx on public.domains(context_entity_id);
create index pages_parent_idx on public.pages(parent_page_id);
create index pages_context_idx on public.pages(context_entity_id);

-- Administrative reorganization is recorded separately from changes to claims.
create table public.hierarchy_changes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entity_id uuid not null references public.entities(id),
  before_state jsonb not null,
  after_state jsonb not null
);
alter table public.hierarchy_changes enable row level security;

-- Recreate topic ancestors inside a context when a general branch is shared.
create or replace function public.ensure_context_topic(p_entity_id uuid,p_root_id uuid,p_root_path text,p_topic_path text)
returns uuid language plpgsql security definer set search_path='' as $$
declare topic_path text; part text; current_id uuid:=p_root_id; child_id uuid; current_path text:=p_root_path;
begin
  if not exists(select 1 from public.domains where id=p_root_id and context_entity_id=p_entity_id) then raise exception 'Invalid context root'; end if;
  topic_path:=regexp_replace(p_topic_path,'^(Topics|General|Knowledge)(/|$)','','i');
  if topic_path='' then return current_id; end if;
  foreach part in array string_to_array(topic_path,'/') loop
    current_path:=current_path||'/'||part;
    select id into child_id from public.domains where path=current_path and context_entity_id=p_entity_id;
    if child_id is null then
      insert into public.domains(name,path,parent_id,proposed_by,context_entity_id)
      values(part,current_path,current_id,'ai',p_entity_id) returning id into child_id;
    end if;
    current_id:=child_id;
  end loop;
  return current_id;
end;
$$;
revoke all on function public.ensure_context_topic(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ensure_context_topic(uuid,uuid,text,text) to service_role;

-- Idempotent, transaction-safe: only exclusively owned branches can move.
-- Shared/general knowledge stays in its existing root. Claims and sources are unchanged.
create or replace function public.organize_entity_context(p_entity_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.entities; root_id uuid; root_path text; branch record; p record;
  old_path text; new_path text; chosen_parent uuid; profile_id uuid;
  before_state jsonb; after_state jsonb; selected_domain uuid; target_parent uuid; topic_parent text;
begin
  perform pg_advisory_xact_lock(hashtext('knowledge-hierarchy'));
  select * into strict e from public.entities where id=p_entity_id and merged_into_id is null;
  if e.type not in ('company','organization','project','person','team','product') then
    raise exception 'This entity type does not establish a context';
  end if;
  select jsonb_build_object('domains',(select jsonb_agg(to_jsonb(d) order by d.id) from public.domains d),
    'pages',(select jsonb_agg(to_jsonb(x) order by x.id) from public.pages x),
    'unitDomains',(select jsonb_agg(to_jsonb(ud) order by ud.unit_id,ud.domain_id) from public.unit_domains ud),
    'sections',(select jsonb_agg(jsonb_build_object('id',s.id,'query',s.query) order by s.id) from public.sections s)) into before_state;

  -- Ambiguous/multi-context claims never establish ownership by themselves.
  create temporary table if not exists hierarchy_owners(unit_id uuid primary key, owner uuid) on commit drop;
  truncate pg_temp.hierarchy_owners;
  insert into pg_temp.hierarchy_owners
    select ue.unit_id, (array_agg(distinct ue.entity_id))[1]
    from public.unit_entities ue join public.entities x on x.id=ue.entity_id
    join public.units u on u.id=ue.unit_id and u.retired_at is null
    where x.type in ('company','organization','project','person','team','product') and x.merged_into_id is null
    group by ue.unit_id having count(distinct ue.entity_id)=1;

  select id,path into root_id,root_path from public.domains
    where context_entity_id=e.id and parent_id is null order by created_at limit 1;
  if root_id is null then
    root_path := replace(e.name,'/','∕');
    if exists(select 1 from public.domains where path=root_path) then root_path:=root_path||' ('||e.type||':'||e.key||')'; end if;
    insert into public.domains(name,path,parent_id,proposed_by,context_entity_id)
      values(e.name,root_path,null,'ai',e.id) returning id into root_id;
  end if;

  -- Find the highest exclusive topic branches, omitting artificial generic wrappers.
  for branch in
    with exclusive as (
      select d.id,d.path,d.parent_id from public.domains d
      where d.context_entity_id is null and lower(d.name) not in ('topics','general','knowledge')
      and exists(select 1 from public.unit_domains ud join public.domains x on x.id=ud.domain_id
        join public.units u on u.id=ud.unit_id and u.retired_at is null
        where x.path=d.path or starts_with(x.path,d.path||'/'))
      and not exists(select 1 from public.unit_domains ud join public.domains x on x.id=ud.domain_id
        join public.units u on u.id=ud.unit_id and u.retired_at is null
        left join pg_temp.hierarchy_owners o on o.unit_id=u.id
        where (x.path=d.path or starts_with(x.path,d.path||'/')) and o.owner is distinct from e.id)
    ) select x.* from exclusive x where not exists(select 1 from exclusive ancestor where ancestor.id=x.parent_id)
      order by length(x.path)
  loop
    old_path:=branch.path;
    topic_parent:=case when position('/' in old_path)>0 then regexp_replace(old_path,'/[^/]+$','') else '' end;
    target_parent:=public.ensure_context_topic(e.id,root_id,root_path,topic_parent);
    select parent.path||'/'||d.name into new_path from public.domains d cross join public.domains parent where d.id=branch.id and parent.id=target_parent;
    -- A conflicting existing branch requires an explicit merge, never silent reassignment.
    if exists(select 1 from public.domains where path=new_path) then continue; end if;
    update public.domains d set path=new_path||substr(d.path,length(old_path)+1), context_entity_id=e.id,
      parent_id=case when d.id=branch.id then target_parent else d.parent_id end
      where d.path=old_path or starts_with(d.path,old_path||'/');
    update public.sections s set query=jsonb_set(s.query,'{domainPaths}',
      (select jsonb_agg(case when v=old_path or starts_with(v,old_path||'/') then new_path||substr(v,length(old_path)+1) else v end)
       from jsonb_array_elements_text(s.query->'domainPaths') t(v)))
      where jsonb_typeof(s.query->'domainPaths')='array'
      and exists(select 1 from jsonb_array_elements_text(s.query->'domainPaths') t(v) where v=old_path or starts_with(v,old_path||'/'));
  end loop;

  -- Split mixed memberships without changing other companies or general claims.
  for branch in select d.* from public.domains d where d.context_entity_id is null
    and exists(select 1 from public.unit_domains ud join pg_temp.hierarchy_owners o on o.unit_id=ud.unit_id where ud.domain_id=d.id and o.owner=e.id)
  loop
    selected_domain:=public.ensure_context_topic(e.id,root_id,root_path,branch.path);
    insert into public.unit_domains(unit_id,domain_id)
      select ud.unit_id,selected_domain from public.unit_domains ud join pg_temp.hierarchy_owners o on o.unit_id=ud.unit_id
      where ud.domain_id=branch.id and o.owner=e.id on conflict do nothing;
    delete from public.unit_domains ud using pg_temp.hierarchy_owners o where ud.unit_id=o.unit_id and o.owner=e.id and ud.domain_id=branch.id;
  end loop;

  -- Scope even branches already created under the named context by future uploads.
  update public.domains set context_entity_id=e.id where path=root_path or starts_with(path,root_path||'/');

  -- Resolve page ownership from cited claims, not from its filename or a guessed title.
  for p in select * from public.pages where retired_at is null loop
    if exists (
      select 1 from public.lines l join public.sections s on s.id=l.section_id
      join public.line_revisions lr on lr.id=l.current_revision_id
      cross join lateral unnest(lr.unit_revision_ids) rid
      join public.revisions r on r.id=rid join pg_temp.hierarchy_owners o on o.unit_id=r.unit_id
      where s.page_id=p.id and s.retired_at is null and l.retired_at is null and o.owner=e.id
    ) and not exists (
      select 1 from public.lines l join public.sections s on s.id=l.section_id
      join public.line_revisions lr on lr.id=l.current_revision_id
      cross join lateral unnest(lr.unit_revision_ids) rid
      join public.revisions r on r.id=rid left join pg_temp.hierarchy_owners o on o.unit_id=r.unit_id
      where s.page_id=p.id and s.retired_at is null and l.retired_at is null and o.owner is distinct from e.id
    ) then
      update public.pages set context_entity_id=e.id where id=p.id;
    end if;
  end loop;
  select id into profile_id from public.pages where retired_at is null and context_entity_id=e.id
    and lower(title)=lower(e.name) order by created_at limit 1;
  if profile_id is not null then update public.pages set domain_id=root_id,parent_page_id=null where id=profile_id; end if;

  for p in select * from public.pages where retired_at is null and context_entity_id=e.id and id is distinct from profile_id loop
    select d.id into selected_domain from public.domains d
      where d.context_entity_id=e.id and exists(select 1 from public.sections s
        cross join lateral jsonb_array_elements_text(case when jsonb_typeof(s.query->'domainPaths')='array' then s.query->'domainPaths' else '[]'::jsonb end) t(v)
        where s.page_id=p.id and s.retired_at is null and v=d.path)
      order by length(d.path) desc limit 1;
    -- A thematic article with explicit claim lists belongs to their common topic.
    if selected_domain is null then
      select d.id into selected_domain from public.domains d where d.context_entity_id=e.id and d.id<>root_id
        and exists(select 1 from public.sections s join public.lines l on l.section_id=s.id and l.retired_at is null
          join public.line_revisions lr on lr.id=l.current_revision_id where s.page_id=p.id and s.retired_at is null)
        and not exists(select 1 from public.sections s join public.lines l on l.section_id=s.id and l.retired_at is null
          join public.line_revisions lr on lr.id=l.current_revision_id cross join lateral unnest(lr.unit_revision_ids) rid
          join public.revisions r on r.id=rid where s.page_id=p.id and s.retired_at is null
          and not exists(select 1 from public.unit_domains ud join public.domains x on x.id=ud.domain_id
            where ud.unit_id=r.unit_id and (x.path=d.path or starts_with(x.path,d.path||'/'))))
        order by length(d.path) desc limit 1;
    end if;
    update public.pages set domain_id=selected_domain where id=p.id;
    -- Entity restriction prevents a future topic with the same name leaking other contexts.
    update public.sections set query=jsonb_set(query,'{entity}',jsonb_build_object('type',e.type,'key',e.key))
      where page_id=p.id and retired_at is null and mode='generated';
  end loop;
  -- Retire only obsolete machine-written wrapper articles; all evidence remains.
  update public.pages wrapper set retired_at=now() where wrapper.context_entity_id=e.id and wrapper.retired_at is null
    and lower(wrapper.title) in ('topics','general','knowledge')
    and not exists(select 1 from public.sections s where s.page_id=wrapper.id and s.retired_at is null and s.mode<>'generated')
    and not exists(select 1 from public.sections s join public.lines l on l.section_id=s.id
      join public.line_revisions lr on lr.id=l.current_revision_id where s.page_id=wrapper.id and lr.author='person');
  -- Domain hub pages are preferred over thematic articles when choosing parents.
  for p in select * from public.pages where retired_at is null and context_entity_id=e.id and id is distinct from profile_id loop
    chosen_parent:=null;
    select candidate.id into chosen_parent from public.pages candidate join public.domains d on d.id=candidate.domain_id
      join public.domains child on child.id=p.domain_id
      where candidate.retired_at is null and candidate.id<>p.id and candidate.context_entity_id=e.id
        and (starts_with(child.path,d.path||'/') or (child.id=d.id and candidate.title=d.name and p.title<>d.name))
      order by length(d.path) desc,(candidate.title=d.name) desc,candidate.created_at limit 1;
    update public.pages set parent_page_id=coalesce(chosen_parent,profile_id) where id=p.id;
  end loop;
  select jsonb_build_object('domains',(select jsonb_agg(to_jsonb(d) order by d.id) from public.domains d),
    'pages',(select jsonb_agg(to_jsonb(x) order by x.id) from public.pages x),
    'unitDomains',(select jsonb_agg(to_jsonb(ud) order by ud.unit_id,ud.domain_id) from public.unit_domains ud),
    'sections',(select jsonb_agg(jsonb_build_object('id',s.id,'query',s.query) order by s.id) from public.sections s)) into after_state;
  if before_state is distinct from after_state then
    insert into public.hierarchy_changes(entity_id,before_state,after_state) values(e.id,before_state,after_state);
  end if;
  return jsonb_build_object('contextId',e.id,'domainId',root_id,'pageId',profile_id);
end;
$$;
revoke all on function public.organize_entity_context(uuid) from public,anon,authenticated;
grant execute on function public.organize_entity_context(uuid) to service_role;

-- Reject invalid navigation updates at the database boundary as well as in the UI.
create or replace function public.check_page_parent() returns trigger language plpgsql set search_path='' as $$
begin
  if new.parent_page_id is not null and exists(
    with recursive ancestors as (
      select id,parent_page_id from public.pages where id=new.parent_page_id
      union select p.id,p.parent_page_id from public.pages p join ancestors a on p.id=a.parent_page_id
    ) select 1 from ancestors where id=new.id
  ) then raise exception 'Page hierarchy cannot contain a cycle'; end if;
  return new;
end;
$$;
create trigger pages_parent_guard before insert or update of parent_page_id on public.pages
for each row execute function public.check_page_parent();
