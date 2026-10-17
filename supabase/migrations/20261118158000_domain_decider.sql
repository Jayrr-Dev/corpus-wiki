-- Domain Decider: one atomic, fenced and reversible structural decision.
do $$
declare t text; c text; definition text; signature regprocedure;
begin
 for t,c in select * from (values ('ai_role_instructions','ai_role_instructions_role_check'),('ai_role_memory','ai_role_memory_role_check')) x(t,c) loop
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid=('public.'||t)::regclass and conname=c;
  execute format('alter table public.%I drop constraint %I',t,c);
  execute format('alter table public.%I add constraint %I %s',t,c,replace(definition,'''composer''','''composer'', ''domain_decider'''));
 end loop;
 foreach signature in array array['public.set_ai_role_model(text,text)'::regprocedure,'public.set_ai_role_effort(text,text)'::regprocedure] loop
  definition:=pg_get_functiondef(signature);
  execute replace(definition,'''composer''','''composer'',''domain_decider''');
 end loop;
end $$;

alter function change_control.apply_update_domain(public.actions) rename to apply_update_domain_before_decider;
create function change_control.apply_update_domain(p_action public.actions) returns void
language plpgsql set search_path='' as $$
declare before_state jsonb; op jsonb; d public.domains; dest public.domains; old_path text; new_path text; claim uuid; s record;
begin
 if p_action.input->>'domainDecider' is distinct from 'true' then
  perform change_control.apply_update_domain_before_decider(p_action); return;
 end if;
 lock table public.domains,public.domain_tabs,public.unit_domains,public.units,public.revisions,public.pages,public.sections in share row exclusive mode;
 before_state:=public.domain_review_snapshot();
 if before_state is distinct from p_action.input->'snapshot' then raise exception 'Domains or knowledge changed. Run Update Domains again.'; end if;
 if jsonb_array_length(p_action.input->'operations') not between 1 and 40 then raise exception 'Invalid operation count'; end if;
 for op in select value from jsonb_array_elements(p_action.input->'operations') loop
  d:=null; dest:=null;
  select * into d from public.domains where path=op->>'sourcePath' and retired_at is null;
  select * into dest from public.domains where path=op->>'destinationPath' and retired_at is null;
  if op->>'operation'='create' then
   if dest.id is null or nullif(btrim(op->>'name'),'') is null or position('/' in op->>'name')>0 then raise exception 'A subdomain requires a live parent and valid name'; end if;
   insert into public.domains(name,path,parent_id,proposed_by,context_entity_id) values(btrim(op->>'name'),dest.path||'/'||btrim(op->>'name'),dest.id,'ai',dest.context_entity_id);
  elsif op->>'operation' in ('rename','move') then
   if d.id is null then raise exception 'Source domain unavailable'; end if;
   old_path:=d.path;
   if op->>'operation'='rename' then
    if nullif(btrim(op->>'name'),'') is null or position('/' in op->>'name')>0 then raise exception 'Invalid name'; end if;
    perform change_control.rename_domain(d.id,op->>'name');
    select path into new_path from public.domains where id=d.id;
   else
    if dest.id is null or d.parent_id is null or dest.id in (select change_control.domain_subtree(d.id))
      or split_part(d.path,'/',1)<>split_part(dest.path,'/',1) or d.context_entity_id is distinct from dest.context_entity_id then raise exception 'Invalid domain move or organizational context'; end if;
    new_path:=dest.path||'/'||d.name;
    update public.domains set parent_id=dest.id where id=d.id;
    update public.domains set path=new_path||substr(path,length(old_path)+1) where id in (select change_control.domain_subtree(d.id));
   end if;
   for s in select id,query from public.sections where jsonb_typeof(query->'domainPaths')='array' loop
    update public.sections set query=jsonb_set(s.query,'{domainPaths}',(select coalesce(jsonb_agg(distinct case when value=old_path or left(value,length(old_path)+1)=old_path||'/' then new_path||substr(value,length(old_path)+1) else value end),'[]') from jsonb_array_elements_text(s.query->'domainPaths'))) where id=s.id;
   end loop;
  elsif op->>'operation'='assign' then
   if dest.id is null or (op->>'sourcePath' is not null and d.id is null) then raise exception 'Assignment domain unavailable'; end if;
   if d.id is not null and (split_part(d.path,'/',1)<>split_part(dest.path,'/',1) or d.context_entity_id is distinct from dest.context_entity_id) then raise exception 'Assignment crosses organizational contexts'; end if;
   if jsonb_array_length(op->'claimIds')=0 then raise exception 'Assignment requires claims'; end if;
   for claim in select value::uuid from jsonb_array_elements_text(op->'claimIds') loop
    if not exists(select 1 from public.units where id=claim and retired_at is null) then raise exception 'Claim unavailable'; end if;
    if d.id is not null and not exists(select 1 from public.unit_domains where unit_id=claim and domain_id=d.id) then raise exception 'Claim is not filed in source domain'; end if;
    if d.id is null and exists(select 1 from public.unit_domains where unit_id=claim) then raise exception 'Claim already has a domain'; end if;
    insert into public.unit_domains(unit_id,domain_id) values(claim,dest.id) on conflict do nothing;
    if d.id is distinct from dest.id then delete from public.unit_domains where unit_id=claim and domain_id=d.id; end if;
   end loop;
  elsif op->>'operation'='delete' then
   if d.id is null or d.parent_id is null or exists(select 1 from public.domains where parent_id=d.id)
      or exists(select 1 from public.unit_domains where domain_id=d.id) or exists(select 1 from public.pages where domain_id=d.id)
      or exists(select 1 from public.sections where query->'domainPaths' ? d.path) then raise exception 'Only empty, unreferenced leaf subdomains can be deleted'; end if;
   update public.domains set retired_at=now() where id=d.id;
  else raise exception 'Unsupported domain operation';
  end if;
 end loop;
 update public.actions set undo_state=jsonb_build_object('before',before_state,'after',public.domain_review_snapshot()) where id=p_action.id;
end $$;

-- Existing snapshot undo restores memberships, paths, parents, pages and filters.
-- Remove domains created by this decision first; no content can be lost because
-- the complete post-decision snapshot must still match.
alter function change_control.undo_domain_review(uuid) rename to undo_domain_review_before_decider;
create function change_control.undo_domain_review(p_action_id uuid) returns void
language plpgsql set search_path='' as $$
declare saved jsonb; is_decider boolean;
begin
 select undo_state,input->>'domainDecider'='true' into saved,is_decider from public.actions where id=p_action_id;
 if is_decider then
  lock table public.domains,public.domain_tabs,public.unit_domains,public.units,public.revisions,public.pages,public.sections in share row exclusive mode;
  if saved->'after' is distinct from public.domain_review_snapshot() then raise exception 'Knowledge changed after this decision. Undo later changes first.'; end if;
  -- Clear memberships to new domains before deleting them, then let snapshot undo restore all memberships.
  delete from public.unit_domains where domain_id not in (select (value->>'id')::uuid from jsonb_array_elements(saved->'before'->'domains'));
  update public.domains d set parent_id=x.parent_id from jsonb_to_recordset(saved->'before'->'domains') x(id uuid,parent_id uuid) where d.id=x.id;
  delete from public.domains where id not in (select (value->>'id')::uuid from jsonb_array_elements(saved->'before'->'domains'));
  update public.actions set undo_state=jsonb_set(saved,'{after}',public.domain_review_snapshot()) where id=p_action_id;
 end if;
 perform change_control.undo_domain_review_before_decider(p_action_id);
end $$;

create function public.record_domain_decision(p_snapshot jsonb,p_review jsonb,p_trace jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare submitted jsonb; cs uuid; result jsonb;
begin
 lock table public.domains,public.domain_tabs,public.unit_domains,public.units,public.revisions,public.pages,public.sections in share row exclusive mode;
 if p_snapshot is distinct from public.domain_review_snapshot() then raise exception 'Knowledge changed. Run Update Domains again.'; end if;
 submitted:=public.submit_change_set(null,'edit','ai','Domain Decider: '||(p_review->>'reason'),p_trace,
  jsonb_build_array(jsonb_build_object('type','update_domain','targetId',null,'expectedRevisionId',null,'passageIds','[]'::jsonb,'speechAct',null,
  'input',p_review||jsonb_build_object('domainReview',true,'domainDecider',true,'operation','restructure','snapshot',p_snapshot))));
 cs:=(submitted->>'changeSetId')::uuid;
 update public.change_sets set actor_attribution=jsonb_build_object('proposedBy',jsonb_build_object('role','domain_decider','model',p_trace->>'modelVersion'),'decidedBy',jsonb_build_object('role','domain_decider','model',p_trace->>'modelVersion')) where id=cs;
 result:=public.commit_change_set(cs);
 return result||jsonb_build_object('changeSetId',cs);
end $$;
revoke all on function public.record_domain_decision(jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_domain_decision(jsonb,jsonb,jsonb) to service_role;
revoke execute on all functions in schema change_control from public,anon,authenticated;
