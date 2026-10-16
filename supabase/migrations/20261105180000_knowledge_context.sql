-- Context is revision evidence; historical unknown associations remain NULL.
-- Column prepared in 20261105175000, committed before this data update.
-- Materialize before writing, then update by primary key. The preview OrioleDB
-- engine panicked on the bulk UPDATE's sequential scan/hash semi-join, while
-- indexed updates succeeded. No table scan remains open during the writes.
do $$
declare snapshots jsonb; snapshot jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'context',jsonb_build_object('entities',coalesce((
  select jsonb_agg(jsonb_build_object('type',e.type,'key',e.key,'role',ue.role) order by e.type,e.key,ue.role)
  from public.unit_entities ue join public.entities e on e.id=ue.entity_id where ue.unit_id=r.unit_id),'[]'::jsonb),
  'applicability',jsonb_build_object('status','unspecified','entities','[]'::jsonb,'conditions',null)))),'[]'::jsonb)
 into snapshots from public.revisions r join public.units u on u.current_revision_id=r.id;
 for snapshot in select value from jsonb_array_elements(snapshots) loop
  update public.revisions set knowledge_context=snapshot->'context' where id=(snapshot->>'id')::uuid;
 end loop;
end $$;

create function change_control.validate_knowledge_context(c jsonb) returns void language plpgsql set search_path='' as $$
declare e jsonb; scope jsonb:=c->'applicability';
begin
 if c is null or jsonb_typeof(c)<>'object' or jsonb_typeof(c->'entities') is distinct from 'array'
 or jsonb_typeof(scope) is distinct from 'object' or coalesce(scope->>'status','') not in ('unspecified','general','scoped')
 or jsonb_typeof(scope->'entities') is distinct from 'array'
 or not (scope ? 'conditions') or jsonb_typeof(scope->'conditions') not in ('string','null') then raise exception 'Invalid knowledge context'; end if;
 if scope->>'status'<>'scoped' and (jsonb_array_length(scope->'entities')>0 or nullif(btrim(scope->>'conditions'),'') is not null) then raise exception 'Only scoped context may have applicability constraints'; end if;
 if scope->>'status'='scoped' and jsonb_array_length(scope->'entities')=0 and nullif(btrim(scope->>'conditions'),'') is null then raise exception 'Scoped context needs an entity or condition'; end if;
 for e in select value from jsonb_array_elements(c->'entities') loop
  if coalesce(e->>'role','') not in ('subject','object','mentioned') then raise exception 'Invalid entity role'; end if;
 end loop;
 for e in select value from jsonb_array_elements((c->'entities')||(scope->'entities')) loop
  if coalesce(btrim(e->>'type'),'')='' or coalesce(btrim(e->>'key'),'')='' or not exists(
   select 1 from public.entities x where x.type=e->>'type' and x.key=e->>'key' and x.retired_at is null and x.merged_into_id is null
  ) then raise exception 'Unknown or inactive entity in knowledge context'; end if;
 end loop;
end $$;

create function change_control.context_merge_key(c jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when c->'applicability'->>'status' in ('general','scoped') then jsonb_build_object(
 'entities',coalesce((select jsonb_agg(x order by x::text) from (select distinct value x from jsonb_array_elements(c->'entities') where value->>'role'<>'mentioned') t),'[]'::jsonb),
 'status',c->'applicability'->>'status',
 'scope',coalesce((select jsonb_agg(x order by x::text) from (select distinct value x from jsonb_array_elements(c->'applicability'->'entities')) t),'[]'::jsonb),
 'conditions',nullif(btrim(c->'applicability'->>'conditions'),'')) end
$$;

-- Unit links are a current-state projection; replace them atomically with revision context.
create function change_control.project_knowledge_context(p_unit uuid) returns uuid[] language plpgsql set search_path='' as $$
declare c jsonb; section_id uuid; old_sections uuid[]; affected uuid[]:='{}';
begin
 select r.knowledge_context into c from public.units u join public.revisions r on r.id=u.current_revision_id where u.id=p_unit;
 if c is null then return '{}'::uuid[]; end if; -- unknown historical snapshot does not invent links
 select array_agg(s.id) into old_sections from public.sections s where s.mode='generated' and
 (p_unit in (select public.living_page_query_units(s.query)) or exists(select 1 from public.section_inputs si where si.section_id=s.id and si.unit_id=p_unit));
 delete from public.unit_entities where unit_id=p_unit;
 insert into public.unit_entities(unit_id,entity_id,role)
 select p_unit,e.id,(x->>'role')::public.entity_role from jsonb_array_elements(c->'entities') x
 join public.entities e on e.type=x->>'type' and e.key=x->>'key' on conflict do nothing;
 for section_id in select s.id from public.sections s where s.mode='generated' and
 (s.id=any(coalesce(old_sections,'{}'::uuid[])) or p_unit in (select public.living_page_query_units(s.query))) loop
  perform public.mark_section_stale(section_id);
  affected:=array_append(affected,section_id);
 end loop;
 return affected;
end $$;

alter function change_control.apply_add_claim(public.actions,uuid,public.actor_kind) rename to apply_add_claim_before_context;
create function change_control.apply_add_claim(p_action public.actions,p_event_id uuid,p_author public.actor_kind) returns void language plpgsql set search_path='' as $$
declare c jsonb; a public.actions; affected uuid[];
begin
 c:=coalesce(p_action.input->'context',jsonb_build_object('entities',coalesce(p_action.input->'entities','[]'::jsonb),'applicability',jsonb_build_object('status','unspecified','entities','[]'::jsonb,'conditions',null)));
 perform change_control.validate_knowledge_context(c);
 perform change_control.apply_add_claim_before_context(p_action,p_event_id,p_author);
 select * into a from public.actions where id=p_action.id;
 update public.revisions set knowledge_context=c where id=a.after_revision_id;
 affected:=change_control.project_knowledge_context(a.target_id);
 update public.actions set undo_state=coalesce(undo_state,'{}'::jsonb)||jsonb_build_object('contextSectionIds',to_jsonb(affected)) where id=a.id;
end $$;

alter function change_control.apply_revise_claim(public.actions,uuid,public.actor_kind) rename to apply_revise_claim_before_context;
create function change_control.apply_revise_claim(p_action public.actions,p_event_id uuid,p_author public.actor_kind) returns void language plpgsql set search_path='' as $$
declare c jsonb; a public.actions; affected uuid[];
begin
 perform 1 from public.units where id=p_action.target_id for update;
 select r.knowledge_context into c from public.units u join public.revisions r on r.id=u.current_revision_id where u.id=p_action.target_id;
 if p_action.input ? 'context' then c:=p_action.input->'context'; perform change_control.validate_knowledge_context(c); end if;
 perform change_control.apply_revise_claim_before_context(p_action,p_event_id,p_author);
 select * into a from public.actions where id=p_action.id;
 update public.revisions set knowledge_context=c where id=a.after_revision_id;
 affected:=change_control.project_knowledge_context(a.target_id);
 update public.actions set undo_state=coalesce(undo_state,'{}'::jsonb)||jsonb_build_object('contextSectionIds',to_jsonb(affected)) where id=a.id;
end $$;

alter function change_control.undo_action(public.actions,uuid) rename to undo_action_before_context;
create function change_control.undo_action(p_action public.actions,p_revert_event_id uuid) returns void language plpgsql set search_path='' as $$
begin
 perform change_control.undo_action_before_context(p_action,p_revert_event_id);
 if p_action.type='revise_claim' then perform change_control.project_knowledge_context(p_action.target_id); end if;
end $$;

alter function change_control.check_references(public.actions) rename to check_references_before_context;
create function change_control.check_references(p_action public.actions) returns jsonb language plpgsql stable set search_path='' as $$
declare c jsonb; other jsonb; d uuid;
begin
 if p_action.type in ('add_claim','revise_claim') and p_action.input ? 'context' then
  begin perform change_control.validate_knowledge_context(p_action.input->'context');
  exception when others then return change_control.check('references',false,sqlerrm); end;
 end if;
 if p_action.type='merge_duplicates' then
  select change_control.context_merge_key(r.knowledge_context) into c from public.units u join public.revisions r on r.id=u.current_revision_id where u.id=p_action.target_id;
  if c is null then return change_control.check('references',false,'Cannot merge unresolved applicability'); end if;
  foreach d in array change_control.uuid_array(p_action.input->'duplicateUnitIds') loop
   select change_control.context_merge_key(r.knowledge_context) into other from public.units u join public.revisions r on r.id=u.current_revision_id where u.id=d and u.retired_at is null;
   if other is null or c<>other then return change_control.check('references',false,'Duplicate contexts differ or are unresolved'); end if;
  end loop;
 end if;
 return change_control.check_references_before_context(p_action);
end $$;

alter function change_control.apply_merge_duplicates(public.actions) rename to apply_merge_duplicates_before_context;
create function change_control.apply_merge_duplicates(p_action public.actions) returns void language plpgsql set search_path='' as $$
declare verdict jsonb;
begin
 perform 1 from public.units where id=p_action.target_id or id=any(change_control.uuid_array(p_action.input->'duplicateUnitIds')) order by id for update;
 verdict:=change_control.check_references(p_action);
 if verdict is not null and not (verdict->>'passed')::boolean then raise exception '%',verdict->>'detail'; end if;
 -- Retired revisions and their source passage IDs remain intact for provenance and undo.
 perform change_control.apply_merge_duplicates_before_context(p_action);
end $$;

alter function public.reconciliation_input(uuid) rename to reconciliation_input_before_context;
create function public.reconciliation_input(p_event_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_set(base,'{existingUnits}',coalesce((select jsonb_agg(x||jsonb_build_object('context',r.knowledge_context))
 from jsonb_array_elements(base->'existingUnits') x left join public.revisions r on r.id=(x->>'revisionId')::uuid),'[]'::jsonb))
 from (select public.reconciliation_input_before_context(p_event_id) base) t
$$;
revoke all on function public.reconciliation_input(uuid) from public,anon,authenticated;
grant execute on function public.reconciliation_input(uuid) to service_role;

-- Add claim-scoped topic sections; existing entity/domain/kind queries keep their behavior.
create or replace function public.living_page_query_units(p_query jsonb)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select u.id
  from public.units u
  where p_query is not null
    and u.retired_at is null
    -- Topic sections select explicit verified claims. An empty list selects nothing.
    and (
      jsonb_typeof(p_query -> 'unitIds') is distinct from 'array'
      or u.id::text in (select jsonb_array_elements_text(p_query -> 'unitIds'))
    )
    -- ENTITY: linked to (type, key) when given
    and (
      jsonb_typeof(p_query -> 'entity') is distinct from 'object'
      or exists (
        select 1
        from public.unit_entities ue
        join public.entities e on e.id = ue.entity_id
        where ue.unit_id = u.id
          and e.type = p_query -> 'entity' ->> 'type'
          and e.key = p_query -> 'entity' ->> 'key'
          and ue.role::text in (select jsonb_array_elements_text(coalesce(p_query->'entityRoles','["subject","object"]'::jsonb)))
      )
    )
    -- DOMAINS: in a listed domain or below it (compared by path prefix, not LIKE)
    and (
      jsonb_typeof(p_query -> 'domainPaths') is distinct from 'array'
      or jsonb_array_length(p_query -> 'domainPaths') = 0
      or exists (
        select 1
        from public.unit_domains ud
        join public.domains d on d.id = ud.domain_id
        cross join jsonb_array_elements_text(p_query -> 'domainPaths') as wanted(path)
        where ud.unit_id = u.id
          and (d.path = wanted.path or left(d.path, length(wanted.path) + 1) = wanted.path || '/')
      )
    )
    -- KINDS: one of the listed kinds
    and (
      jsonb_typeof(p_query -> 'kinds') is distinct from 'array'
      or jsonb_array_length(p_query -> 'kinds') = 0
      or u.kind::text in (select jsonb_array_elements_text(p_query -> 'kinds'))
    );
$$;

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
    where ue.role <> 'mentioned' and x.type in ('company','organization','project','person','team','product') and x.merged_into_id is null
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

revoke all on all functions in schema change_control from public,anon,authenticated;
alter function public.read_section_state(uuid) rename to read_section_state_before_context;
create function public.read_section_state(p_section_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_set(base,'{units}',coalesce((select jsonb_agg(x||jsonb_build_object('context',r.knowledge_context))
 from jsonb_array_elements(base->'units') x left join public.revisions r on r.id=(x->>'revisionId')::uuid),'[]'::jsonb))
 from (select public.read_section_state_before_context(p_section_id) base) t
$$;
revoke all on function public.read_section_state(uuid) from public,anon,authenticated;
grant execute on function public.read_section_state(uuid) to service_role;

-- Include sections that matched before a context correction, even if not built yet.
alter function public.list_affected_sections(uuid) rename to list_affected_sections_before_context;
create function public.list_affected_sections(p_event_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item),'[]'::jsonb) from (
  select value item from jsonb_array_elements(public.list_affected_sections_before_context(p_event_id))
  union
  select jsonb_build_object('sectionId',s.id,'pageId',s.page_id)
  from public.actions a join public.change_sets cs on cs.id=a.change_set_id
  cross join lateral jsonb_array_elements_text(coalesce(a.undo_state->'contextSectionIds','[]'::jsonb)) affected(id)
  join public.sections s on s.id=affected.id::uuid
  where (cs.event_id=p_event_id and a.outcome='applied') or a.reverted_by_event_id=p_event_id
 ) entries
$$;
revoke all on function public.list_affected_sections(uuid) from public,anon,authenticated;
grant execute on function public.list_affected_sections(uuid) to service_role;
