-- Tabs group roots by stable IDs; domain paths and organization context stay intact.
create table public.domain_tabs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null check (length(trim(description)) between 1 and 2000),
  root_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create unique index domain_tabs_name on public.domain_tabs (lower(name));
alter table public.domain_tabs enable row level security;
create policy domain_tabs_read on public.domain_tabs for select to authenticated using (true);
grant select on public.domain_tabs to authenticated;
grant all on public.domain_tabs to service_role;

insert into public.domain_tabs(id,name,description,root_ids) values
('00000000-0000-4000-8000-000000000001','Organizations','Organizations can be roots. File their policies and practices under their own root.',
  array(select id from public.domains where parent_id is null and context_entity_id is not null)),
('00000000-0000-4000-8000-000000000002','External references','General reference topics can be roots. Keep external guidance separate from organization policies.',
  array(select id from public.domains where parent_id is null and context_entity_id is null));

create function public.group_new_domain_root()
returns trigger language plpgsql security definer set search_path='' as $$
declare tab_id uuid;
begin
  if new.parent_id is not null then return new; end if;
  select nullif(a.input->>'domainTabId','')::uuid into tab_id from public.actions a
    where a.type='create_domain' and a.input->>'path'=new.path and a.outcome='pending'
    order by a.created_at desc limit 1;
  tab_id := coalesce(tab_id, case when new.context_entity_id is null
    then '00000000-0000-4000-8000-000000000002'::uuid
    else '00000000-0000-4000-8000-000000000001'::uuid end);
  update public.domain_tabs set root_ids=array_append(root_ids,new.id) where id=tab_id;
  if not found then raise exception 'The selected domain tab no longer exists.'; end if;
  return new;
end $$;
revoke all on function public.group_new_domain_root() from public,anon,authenticated;
create trigger domains_group_root after insert on public.domains
  for each row execute function public.group_new_domain_root();

create function public.save_domain_tab(p_id uuid, p_name text, p_description text, p_root_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare tab_id uuid := coalesce(p_id, gen_random_uuid());
begin
  -- Serialize membership moves, including concurrent requests for the same root.
  lock table public.domain_tabs in exclusive mode;
  if p_id is not null and not exists(select 1 from public.domain_tabs where id=p_id) then
    raise exception 'This tab no longer exists.';
  end if;
  if exists(select 1 from unnest(p_root_ids) r(id) where not exists(
    select 1 from public.domains d where d.id=r.id and d.parent_id is null
  )) then raise exception 'Only existing root domains can belong to tabs.'; end if;
  update public.domain_tabs set root_ids=array(select r from unnest(root_ids) r where not(r=any(p_root_ids))) where id<>tab_id;
  insert into public.domain_tabs(id,name,description,root_ids)
    values(tab_id,trim(p_name),trim(p_description),p_root_ids)
    on conflict(id) do update set name=excluded.name,description=excluded.description,root_ids=excluded.root_ids;
  -- Deselected roots return to the default group; no root disappears from the UI.
  update public.domain_tabs t set root_ids=t.root_ids || array(
    select d.id from public.domains d where d.parent_id is null
      and not exists(select 1 from public.domain_tabs x where d.id=any(x.root_ids))
      and t.id=case when d.context_entity_id is null
        then '00000000-0000-4000-8000-000000000002'::uuid
        else '00000000-0000-4000-8000-000000000001'::uuid end
  ) where t.id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
  return jsonb_build_object('id',tab_id);
end $$;
revoke all on function public.save_domain_tab(uuid,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.save_domain_tab(uuid,text,text,uuid[]) to service_role;

-- Extend the input additively so existing callers and action shapes remain valid.
alter function public.reconciliation_input(uuid) rename to reconciliation_input_before_tabs;
create function public.reconciliation_input(p_event_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.reconciliation_input_before_tabs(p_event_id) || jsonb_build_object('domainTabs',coalesce((
    select jsonb_agg(jsonb_build_object('name',t.name,'description',t.description,'rootPaths',
      coalesce((select jsonb_agg(d.path order by d.path) from public.domains d
        where d.id=any(t.root_ids) and d.parent_id is null and d.retired_at is null),'[]'::jsonb)))
    from public.domain_tabs t),'[]'::jsonb))
$$;
revoke all on function public.reconciliation_input(uuid) from public,anon,authenticated;
grant execute on function public.reconciliation_input(uuid) to service_role;
