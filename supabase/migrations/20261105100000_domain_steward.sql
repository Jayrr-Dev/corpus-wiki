-- Domain reviews are ordinary audited update_domain actions with a constrained
-- domainReview payload. Existing edits retain their original check/apply/undo.
alter table public.ai_role_instructions drop constraint ai_role_instructions_role_check;
alter table public.ai_role_instructions add constraint ai_role_instructions_role_check check
  (role in ('extract_knowledge','identify_entities','link_knowledge','organize_topics','define_concepts','plan_articles','write_articles','researcher','reviewer','domain_steward'));

create function public.domain_review_snapshot() returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object(
 'domains',coalesce((select jsonb_agg(to_jsonb(d) order by id) from public.domains d),'[]'),
 'tabs',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.domain_tabs t),'[]'),
 'unitDomains',coalesce((select jsonb_agg(to_jsonb(u) order by unit_id,domain_id) from public.unit_domains u),'[]'),
 'claims',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'revisionId',u.current_revision_id,'retiredAt',u.retired_at,'content',r.content) order by u.id) from public.units u join public.revisions r on r.id=u.current_revision_id),'[]'),
 'pages',coalesce((select jsonb_agg(jsonb_build_object('id',id,'domain_id',domain_id) order by id) from public.pages),'[]'),
 'sections',coalesce((select jsonb_agg(jsonb_build_object('id',id,'query',query) order by id) from public.sections),'[]'));
$$;

alter function change_control.judge(public.actions,public.actor_kind) rename to judge_before_domain_steward;
create function change_control.judge(p_action public.actions,p_proposed_by public.actor_kind) returns jsonb
language plpgsql stable set search_path='' as $$
begin
 if p_action.type::text='update_domain' and p_action.input->>'domainReview'='true' then
   if p_action.input->'snapshot' is distinct from public.domain_review_snapshot() then
     return jsonb_build_object('outcome','rejected','checks',jsonb_build_array(change_control.check('domain_snapshot',false,'Domains or their content changed. Run the review again.')));
   end if;
   if p_action.input->>'operation'='inspect' or p_action.input->>'confident' is distinct from 'true' then
     return jsonb_build_object('outcome','exception','reason','domain_tree_review','detail',p_action.input->>'reason','checks',jsonb_build_array(change_control.check('domain_review',false,p_action.input->>'reason')));
   end if;
   return jsonb_build_object('outcome','applied','checks',jsonb_build_array(change_control.check('domain_review',true,p_action.input->>'reason')));
 end if;
 return change_control.judge_before_domain_steward(p_action,p_proposed_by);
end $$;

alter function change_control.apply_update_domain(public.actions) rename to apply_update_domain_before_steward;
create function change_control.apply_update_domain(p_action public.actions) returns void
language plpgsql set search_path='' as $$
declare d public.domains; dest public.domains; before_state jsonb; operation text:=p_action.input->>'operation'; new_path text; s record;
begin
 if p_action.input->>'domainReview' is distinct from 'true' then
   perform change_control.apply_update_domain_before_steward(p_action); return;
 end if;
 lock table public.domains,public.domain_tabs,public.unit_domains,public.units,public.revisions,public.pages,public.sections in share row exclusive mode;
 before_state:=public.domain_review_snapshot();
 if before_state is distinct from p_action.input->'snapshot' then raise exception 'Domains or their content changed. Run the review again.'; end if;
 if operation not in ('none','inspect','rename','merge') or operation is null then raise exception 'Unsupported domain operation'; end if;
 if operation in ('rename','merge') then
   select * into d from public.domains where id=p_action.target_id and retired_at is null;
   if not found then raise exception 'Domain unavailable'; end if;
   if operation='merge' then
     select * into dest from public.domains where id=(p_action.input->>'destinationId')::uuid and retired_at is null;
     if not found or d.id=dest.id or d.parent_id is null or d.parent_id is distinct from dest.parent_id
        or d.context_entity_id is distinct from dest.context_entity_id
        or exists(select 1 from public.domains where parent_id=d.id) then
       raise exception 'Consolidation requires leaf topics with the same parent and context.';
     end if;
     new_path:=dest.path;
     insert into public.unit_domains(unit_id,domain_id) select unit_id,dest.id from public.unit_domains where domain_id=d.id on conflict do nothing;
     delete from public.unit_domains where domain_id=d.id;
     update public.pages set domain_id=dest.id where domain_id=d.id;
     update public.domains set retired_at=now() where id=d.id;
   else
     if nullif(btrim(p_action.input->>'name'),'') is null or position('/' in p_action.input->>'name')>0 then raise exception 'Invalid domain name'; end if;
     new_path:=change_control.renamed_domain_path(d.id,p_action.input->>'name');
     perform change_control.rename_domain(d.id,p_action.input->>'name');
   end if;
   -- Section filters must follow the paths, including renamed descendants.
   for s in select id,query from public.sections where jsonb_typeof(query->'domainPaths')='array' loop
     update public.sections set query=jsonb_set(s.query,'{domainPaths}',
       (select coalesce(jsonb_agg(distinct case when value=d.path then new_path
         when operation='rename' and left(value,length(d.path)+1)=d.path||'/' then new_path||substr(value,length(d.path)+1) else value end),'[]')
        from jsonb_array_elements_text(s.query->'domainPaths'))) where id=s.id;
   end loop;
 end if;
 update public.actions set undo_state=jsonb_build_object('before',before_state,'after',public.domain_review_snapshot()) where id=p_action.id;
end $$;

alter function change_control.undo_catalog_action(public.actions) rename to undo_catalog_before_steward;
create function change_control.undo_domain_review(p_action_id uuid) returns void
language plpgsql set search_path='' as $$
declare original jsonb; saved jsonb; operation text;
begin
 -- Read the large snapshot separately from input to avoid a database memory
 -- allocation failure when both toasted JSON values are loaded together.
 select a.undo_state into saved from public.actions a where a.id=p_action_id;
 select a.input->>'operation' into operation from public.actions a where a.id=p_action_id and a.input->>'domainReview'='true';
 if not found then raise exception 'Domain review not found'; end if;
 if operation in ('none','inspect') then return; end if;
 original:=saved->'before';
 lock table public.domains,public.domain_tabs,public.unit_domains,public.units,public.revisions,public.pages,public.sections in share row exclusive mode;
 if saved->'after' is distinct from public.domain_review_snapshot() then
   raise exception 'Domains or their content changed after this decision. Undo later changes first.';
 end if;
 -- First clear path uniqueness while restoring the old hierarchy.
 update public.domains set path='__domain_undo__/'||id::text;
 update public.domains d set name=x.name,path=x.path,parent_id=x.parent_id,retired_at=x.retired_at
 from jsonb_populate_recordset(null::public.domains,original->'domains') x where d.id=x.id;
 delete from public.unit_domains;
 insert into public.unit_domains select * from jsonb_populate_recordset(null::public.unit_domains,original->'unitDomains');
 update public.pages p set domain_id=x.domain_id from jsonb_to_recordset(original->'pages') x(id uuid,domain_id uuid) where p.id=x.id;
 update public.sections s set query=x.query from jsonb_to_recordset(original->'sections') x(id uuid,query jsonb) where s.id=x.id;
end $$;

create function change_control.undo_catalog_action(p_action public.actions) returns void
language plpgsql set search_path='' as $$
begin
 if p_action.input->>'domainReview'='true' then perform change_control.undo_domain_review(p_action.id);
 else perform change_control.undo_catalog_before_steward(p_action); end if;
end $$;

-- Review sets contain one operation. Load the larger snapshot by ID rather
-- than passing its toasted composite record through the legacy dispatcher.
alter function public.revert_change_set(uuid) rename to revert_before_domain_steward;
create function public.revert_change_set(p_change_set_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cs public.change_sets; ev uuid;
begin
 select * into cs from public.change_sets where id=p_change_set_id for update;
 if not exists(select 1 from public.actions where change_set_id=cs.id and input->>'domainReview'='true') then
   return public.revert_before_domain_steward(p_change_set_id);
 end if;
 if cs.status not in ('applied','partly_applied') then raise exception 'Only an applied decision can be reversed.'; end if;
 insert into public.shift_events(cause,actor,status) values('revert','person','checking') returning id into ev;
 perform change_control.undo_domain_review(id) from public.actions where change_set_id=cs.id and outcome='applied';
 update public.actions set outcome='reverted',reverted_by_event_id=ev where change_set_id=cs.id and outcome='applied';
 update public.change_sets set status='reverted' where id=cs.id;
 update public.shift_events set status='reverted' where id=cs.event_id;
 update public.shift_events set status='applied',finished_at=now() where id=ev;
 return jsonb_build_object('eventId',ev);
end $$;

-- Structure exceptions for this role hold a proposal BEFORE applying it.
alter function public.resolve_exception(uuid,boolean,text) rename to resolve_before_domain_steward;
create function public.resolve_exception(p_exception_id uuid,p_accept boolean,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare x public.exceptions; a public.actions; cs public.change_sets;
begin
 select * into x from public.exceptions where id=p_exception_id for update;
 select * into a from public.actions where id=x.action_id for update;
 if a.input->>'domainReview' is distinct from 'true' then return public.resolve_before_domain_steward(p_exception_id,p_accept,p_note); end if;
 select * into cs from public.change_sets where id=a.change_set_id for update;
 if x.status is distinct from 'open' then raise exception 'This exception is already answered.'; end if;
 update public.exceptions set status=case when p_accept then 'accepted' else 'rejected' end::public.exception_status,
   resolved_at=now(),note=coalesce(p_note,note) where id=x.id;
 if p_accept then return change_control.accept_held_action(a,cs); end if;
 update public.actions set outcome='rejected' where id=a.id;
 perform change_control.refresh_status(cs.id);
 return jsonb_build_object('eventId',null);
end $$;

create function public.record_domain_review(p_snapshot jsonb,p_review jsonb,p_trace jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare submitted jsonb; result jsonb; cs uuid;
begin
 lock table public.domains,public.domain_tabs,public.unit_domains,public.units,public.revisions,public.pages,public.sections in share row exclusive mode;
 if p_snapshot is distinct from public.domain_review_snapshot() then raise exception 'Domains or content changed during the review. Run it again.'; end if;
 submitted:=public.submit_change_set(null,'edit','ai','Domain structure review: '||(p_review->>'reason'),p_trace,
   jsonb_build_array(jsonb_build_object('type','update_domain','targetId',p_review->'domainId','expectedRevisionId',null,
     'passageIds','[]'::jsonb,'speechAct',null,'input',p_review||jsonb_build_object('domainReview',true,'snapshot',p_snapshot))));
 cs:=(submitted->>'changeSetId')::uuid;
 update public.change_sets set actor_attribution=jsonb_build_object('proposedBy',jsonb_build_object('role','domain_steward','model',p_trace->>'modelVersion'),
   'decidedBy',jsonb_build_object('role','domain_steward','model',p_trace->>'modelVersion')) where id=cs;
 result:=public.commit_change_set(cs);
 return result||jsonb_build_object('changeSetId',cs);
end $$;

revoke all on function public.domain_review_snapshot(),public.record_domain_review(jsonb,jsonb,jsonb),public.resolve_exception(uuid,boolean,text),public.resolve_before_domain_steward(uuid,boolean,text),public.revert_change_set(uuid),public.revert_before_domain_steward(uuid) from public,anon,authenticated;
grant execute on function public.domain_review_snapshot(),public.record_domain_review(jsonb,jsonb,jsonb),public.resolve_exception(uuid,boolean,text),public.revert_change_set(uuid) to service_role;
revoke execute on all functions in schema change_control from public,anon,authenticated;
