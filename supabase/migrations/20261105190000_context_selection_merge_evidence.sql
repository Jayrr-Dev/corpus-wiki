-- A subject/object association and applicability are independent reasons for relevance.
-- General knowledge has no implicit entity ownership; passing mentions remain opt-in.
create or replace function public.living_page_query_units(p_query jsonb)
returns setof uuid language sql stable set search_path='' as $$
 select u.id from public.units u join public.revisions r on r.id=u.current_revision_id
 where p_query is not null and u.retired_at is null
 and (jsonb_typeof(p_query->'unitIds') is distinct from 'array' or u.id::text in (select jsonb_array_elements_text(p_query->'unitIds')))
 and (jsonb_typeof(p_query->'entity') is distinct from 'object' or exists (
  select 1 from public.unit_entities ue join public.entities e on e.id=ue.entity_id
  where ue.unit_id=u.id and e.type=p_query->'entity'->>'type' and e.key=p_query->'entity'->>'key'
  and ue.role::text in (select jsonb_array_elements_text(coalesce(p_query->'entityRoles','["subject","object"]'::jsonb)))
 ) or (r.knowledge_context->'applicability'->>'status'='scoped' and exists (
  select 1 from jsonb_array_elements(r.knowledge_context->'applicability'->'entities') e
  where e->>'type'=p_query->'entity'->>'type' and e->>'key'=p_query->'entity'->>'key'
 )))
 and (jsonb_typeof(p_query->'domainPaths') is distinct from 'array' or jsonb_array_length(p_query->'domainPaths')=0 or exists (
  select 1 from public.unit_domains ud join public.domains d on d.id=ud.domain_id
  cross join jsonb_array_elements_text(p_query->'domainPaths') wanted(path)
  where ud.unit_id=u.id and (d.path=wanted.path or starts_with(d.path,wanted.path||'/'))
 ))
 and (jsonb_typeof(p_query->'kinds') is distinct from 'array' or jsonb_array_length(p_query->'kinds')=0 or u.kind::text in (select jsonb_array_elements_text(p_query->'kinds')))
$$;

-- Merge evidence into a NEW survivor revision, preserving every original snapshot.
-- Context equivalence is checked again under row locks; mentions may be unioned.
create or replace function change_control.apply_merge_duplicates(p_action public.actions)
returns void language plpgsql set search_path='' as $$
declare verdict jsonb; original public.revisions; new_revision uuid; merged_context jsonb;
 passages uuid[]; source_date timestamptz; event_id uuid; actor public.actor_kind; affected uuid[];
 ids uuid[]:=change_control.uuid_array(p_action.input->'duplicateUnitIds');
begin
 perform 1 from public.units where id=p_action.target_id or id=any(ids) order by id for update;
 verdict:=change_control.check_references(p_action);
 if verdict is not null and not (verdict->>'passed')::boolean then raise exception '%',verdict->>'detail'; end if;
 select r.* into strict original from public.units u join public.revisions r on r.id=u.current_revision_id where u.id=p_action.target_id;
 select cs.event_id,cs.proposed_by into event_id,actor from public.change_sets cs where cs.id=p_action.change_set_id;
 select array_agg(distinct p order by p) into passages from public.units u join public.revisions r on r.id=u.current_revision_id
 cross join lateral unnest(r.passage_ids) p where u.id=p_action.target_id or u.id=any(ids);
 select max(r.source_date) into source_date from public.units u join public.revisions r on r.id=u.current_revision_id where u.id=p_action.target_id or u.id=any(ids);
 select jsonb_set(original.knowledge_context,'{entities}',coalesce(jsonb_agg(x order by x::text),'[]'::jsonb)) into merged_context from (
  select distinct x from public.units u join public.revisions r on r.id=u.current_revision_id
  cross join lateral jsonb_array_elements(r.knowledge_context->'entities') x where u.id=p_action.target_id or u.id=any(ids)
 ) all_entities;
 perform change_control.apply_merge_duplicates_before_context(p_action);
 insert into public.revisions(unit_id,content,title,replaces_revision_id,passage_ids,source_date,event_id,author,knowledge_context)
 values(original.unit_id,original.content,original.title,original.id,coalesce(passages,'{}'),source_date,event_id,actor,merged_context)
 returning id into new_revision;
 update public.units set current_revision_id=new_revision,last_changed_at=now() where id=original.unit_id;
 update public.actions set before_revision_id=original.id,after_revision_id=new_revision where id=p_action.id;
 affected:=change_control.project_knowledge_context(original.unit_id);
 update public.actions set undo_state=coalesce(undo_state,'{}'::jsonb)||jsonb_build_object('contextSectionIds',to_jsonb(affected),'contextMerged',true) where id=p_action.id;
end $$;

create or replace function change_control.undo_action(p_action public.actions,p_revert_event_id uuid)
returns void language plpgsql set search_path='' as $$
begin
 if p_action.type='merge_duplicates' and coalesce((p_action.undo_state->>'contextMerged')::boolean,false) then
  perform 1 from public.units where id=p_action.target_id for update;
  if (select current_revision_id from public.units where id=p_action.target_id) is distinct from p_action.after_revision_id then
   raise exception 'Undo the later survivor change before undoing this merge';
  end if;
  update public.units set current_revision_id=p_action.before_revision_id,last_changed_at=now() where id=p_action.target_id;
 end if;
 perform change_control.undo_action_before_context(p_action,p_revert_event_id);
 if p_action.type='revise_claim' or (p_action.type='merge_duplicates' and coalesce((p_action.undo_state->>'contextMerged')::boolean,false)) then
  perform change_control.project_knowledge_context(p_action.target_id);
 end if;
end $$;

-- The projection runs after switching revisions. Recover prior scope-only matches
-- from revision evidence as well as current links, including before first build.
create or replace function change_control.project_knowledge_context(p_unit uuid) returns uuid[] language plpgsql set search_path='' as $$
declare c jsonb; section_id uuid; old_sections uuid[]; affected uuid[]:='{}';
begin
 select r.knowledge_context into c from public.units u join public.revisions r on r.id=u.current_revision_id where u.id=p_unit;
 -- Unknown historical evidence must not inherit the projection of a newer revision.
 -- Clear current links without fabricating a historical snapshot.
 if c is null then c:=jsonb_build_object('entities','[]'::jsonb); end if;
 select array_agg(s.id) into old_sections from public.sections s where s.mode='generated' and (
  p_unit in (select public.living_page_query_units(s.query))
  or exists(select 1 from public.section_inputs si where si.section_id=s.id and si.unit_id=p_unit)
  or exists(select 1 from public.revisions r cross join lateral jsonb_array_elements(coalesce(r.knowledge_context->'applicability'->'entities','[]'::jsonb)) e
    where r.unit_id=p_unit and e->>'type'=s.query->'entity'->>'type' and e->>'key'=s.query->'entity'->>'key')
 );
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

-- Projection has one role per entity identity; reject conflicting snapshots.
alter function change_control.validate_knowledge_context(jsonb) rename to validate_knowledge_context_before_roles;
create function change_control.validate_knowledge_context(c jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform change_control.validate_knowledge_context_before_roles(c);
 if exists(select 1 from jsonb_array_elements(c->'entities') e group by e->>'type',e->>'key' having count(distinct e->>'role')>1) then
  raise exception 'An entity cannot have conflicting roles in one claim';
 end if;
end $$;
revoke all on function change_control.validate_knowledge_context(jsonb) from public,anon,authenticated;


-- A snapshot can be attached once by the applying action; later edits need a revision.
create function public.protect_revision_knowledge_context() returns trigger language plpgsql set search_path='' as $$
begin
 if old.knowledge_context is not null and new.knowledge_context is distinct from old.knowledge_context then
  raise exception 'Knowledge context is immutable; create a revision instead';
 end if;
 return new;
end $$;
create trigger revision_knowledge_context_immutable before update of knowledge_context on public.revisions
for each row execute function public.protect_revision_knowledge_context();
revoke all on function public.protect_revision_knowledge_context() from public,anon,authenticated;
