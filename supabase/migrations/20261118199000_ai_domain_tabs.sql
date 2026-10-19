-- Navigation only. Ownership, paths, claims and provenance remain untouched.
grant create on schema public to space_runtime;
create function public.domain_tab_layout() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'tabs', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'root_ids',root_ids) order by id) from public.domain_tabs),'[]'::jsonb),
    'roots', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'path',path,'context_entity_id',context_entity_id) order by id) from public.domains where parent_id is null and retired_at is null),'[]'::jsonb)
  )
$$;
alter function public.domain_tab_layout() owner to space_runtime;
revoke all on function public.domain_tab_layout() from public,anon,authenticated;
grant execute on function public.domain_tab_layout() to service_role;

create function public.apply_domain_tab_plan(p_snapshot jsonb, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare entry jsonb; current_tab public.domain_tabs; assigned uuid[]; kept uuid[]; changed integer := 0;
begin
  -- One short transaction: stale suggestions and any invalid entry roll back all moves.
  lock table public.domains,public.domain_tabs in share row exclusive mode;
  if p_snapshot is distinct from public.domain_tab_layout() then
    raise exception 'Domains or tabs changed. Generate a new suggestion before applying.';
  end if;
  if jsonb_typeof(p_plan->'tabs') is distinct from 'array' or jsonb_array_length(p_plan->'tabs') not between 1 and 40 then
    raise exception 'Invalid tab plan';
  end if;
  if exists(select 1 from jsonb_array_elements(p_plan->'tabs') t
    where jsonb_typeof(t->'rootIds') is distinct from 'array'
      or t->>'name' is null or length(btrim(t->>'name')) not between 1 and 80
      or t->>'description' is null or length(btrim(t->>'description')) not between 1 and 2000) then
    raise exception 'Invalid tab details';
  end if;
  if exists(select 1 from jsonb_array_elements(p_plan->'tabs') t group by lower(btrim(t->>'name')) having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_plan->'tabs') t where t->>'id' is not null group by t->>'id' having count(*)>1) then
    raise exception 'Repeated tab';
  end if;
  if exists(select 1 from public.domain_tabs d where not exists(select 1 from jsonb_array_elements(p_plan->'tabs') t where t->>'id'=d.id::text)) then
    raise exception 'Keep all existing tabs';
  end if;
  for entry in select value from jsonb_array_elements(p_plan->'tabs') loop
    if entry->>'id' is not null then
      select * into current_tab from public.domain_tabs where id=(entry->>'id')::uuid;
      if not found or current_tab.name is distinct from entry->>'name' or current_tab.description is distinct from entry->>'description' then
        raise exception 'Existing tab names and descriptions must stay unchanged';
      end if;
    elsif jsonb_array_length(entry->'rootIds')=0 then raise exception 'A new tab needs a root domain';
    end if;
  end loop;
  select coalesce(array_agg(r::uuid),'{}'::uuid[]) into assigned
    from jsonb_array_elements(p_plan->'tabs') t cross join lateral jsonb_array_elements_text(t->'rootIds') r;
  if cardinality(assigned) <> (select count(distinct r) from unnest(assigned) r)
    or exists(select 1 from unnest(assigned) r where not exists(select 1 from public.domains d where d.id=r and d.parent_id is null and d.retired_at is null))
    or exists(select 1 from public.domains d where d.parent_id is null and d.retired_at is null and not(d.id=any(assigned))) then
    raise exception 'Assign each active root exactly once';
  end if;
  -- Use the established membership writer, in this transaction. Preserve retired roots.
  for entry in select value from jsonb_array_elements(p_plan->'tabs') loop
    select coalesce(array_agg(d.id),'{}'::uuid[]) into kept from public.domain_tabs x
      join public.domains d on d.id=any(x.root_ids) where x.id=(entry->>'id')::uuid and d.retired_at is not null and d.parent_id is null;
    perform public.save_domain_tab((entry->>'id')::uuid,entry->>'name',entry->>'description',
      kept || array(select r::uuid from jsonb_array_elements_text(entry->'rootIds') r));
    changed := changed + 1;
  end loop;
  return jsonb_build_object('tabs',changed);
end $$;
alter function public.apply_domain_tab_plan(jsonb,jsonb) owner to space_runtime;
revoke all on function public.apply_domain_tab_plan(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_domain_tab_plan(jsonb,jsonb) to service_role;
revoke create on schema public from space_runtime;
