-- Auto Decide is opt-in. Each choice is atomic, audited and undoable.
alter table public.workspace_settings add column glossary_auto_decide boolean not null default false;
create or replace function public.get_workspace_settings()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'glossaryAutoDecide', coalesce((select s.glossary_auto_decide from public.workspace_settings s where s.id), false),
    'aiModel', (select s.ai_model from public.workspace_settings s where s.id),
    'aiRoleModels', coalesce((select s.ai_role_models from public.workspace_settings s where s.id), '{}'::jsonb),
    'aiEffort', (select s.ai_effort from public.workspace_settings s where s.id),
    'aiRoleEfforts', coalesce((select s.ai_role_efforts from public.workspace_settings s where s.id), '{}'::jsonb),
    'aiRoleAuto', coalesce((select s.ai_role_auto from public.workspace_settings s where s.id), '[]'::jsonb),
    'autoUpdateStale', coalesce((select s.auto_update_stale from public.workspace_settings s where s.id), true),
    'allowExternalKnowledge', coalesce((select s.allow_external_knowledge from public.workspace_settings s where s.id), false),
    'ourEntityId', (select s.our_entity_id from public.workspace_settings s where s.id),
    'articleCharter', coalesce((select s.article_charter from public.workspace_settings s where s.id), '{}'::jsonb)
  );
$$;


create function public.set_glossary_auto_decide(p_enabled boolean) returns void
language sql security definer set search_path='' as $$
 insert into public.workspace_settings(id,glossary_auto_decide,updated_at) values(true,p_enabled,now())
 on conflict(id) do update set glossary_auto_decide=excluded.glossary_auto_decide,updated_at=excluded.updated_at;
$$;
create function public.get_glossary_auto_decide() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('entries',g.entries,'pending',g.pending_entries)
 from public.glossary_state g,public.workspace_settings s
 where g.id and s.id and s.glossary_auto_decide and (g.lease_until is null or g.lease_until<=now());
$$;
create function change_control.apply_glossary_auto_review(p_id text,p_decision text,p_target text,p_definition text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare state public.glossary_state; item jsonb; proposed jsonb; target jsonb; updated jsonb; new_id text; k text; old_snapshot jsonb;
begin
 select * into state from public.glossary_state where id for update;
 if state.lease_until>now() then raise exception 'Wait for the glossary update to finish.'; end if;
 select e into item from jsonb_array_elements(state.pending_entries) e where e->'entry'->>'meaningId'=p_id;
 if item is null then raise exception 'This pending definition changed. Refresh and try again.'; end if;
 proposed:=item->'entry'; new_id:=p_id;
 old_snapshot:=jsonb_build_object('entries',state.entries,'inputHash',state.input_hash,'generatedAt',state.generated_at,
   'identityRegistry',state.identity_registry,'definitionOverrides',state.definition_overrides,'pendingEntries',state.pending_entries);
 if p_decision='dismiss' then
   state.definition_overrides:=state.definition_overrides||jsonb_build_object(p_id,jsonb_build_object('deleted',true));
 elsif p_decision='keep' then
   if exists(select 1 from jsonb_array_elements(state.entries) e where e->>'meaningId'=p_id) then new_id:=gen_random_uuid()::text; end if;
   proposed:=proposed||jsonb_build_object('meaningId',new_id,'keepSeparate',true);
   -- Auto Decide kept these origins separate.
   select coalesce(jsonb_agg(e||jsonb_build_object('originKeys',coalesce((select jsonb_agg(origin.value) from jsonb_array_elements_text(coalesce(e->'originKeys','[]')) origin(value)
     where not(coalesce(proposed->'originKeys','[]') ? origin.value)),'[]'))),'[]') into state.entries from jsonb_array_elements(state.entries) e;
   state.entries:=state.entries||jsonb_build_array(proposed);
   state.definition_overrides:=state.definition_overrides||jsonb_build_object(new_id,jsonb_build_object('separate',true));
 elsif p_decision='merge' then
   if p_definition is null or length(btrim(p_definition))<10 or length(p_definition)>1000 then raise exception 'Enter a combined definition of 10 to 1,000 characters.'; end if;
   select e into target from jsonb_array_elements(state.entries) e where e->>'meaningId'=p_target;
   if target is null or not(item->'candidateIds' ? p_target) then raise exception 'Select a current candidate meaning.'; end if;
   new_id:=p_target;
   updated:=target||jsonb_build_object('definition',btrim(p_definition),'personEdited',coalesce((target->>'personEdited')::boolean,false),
     'aliases',coalesce((select jsonb_agg(distinct x) from jsonb_array_elements(coalesce(target->'aliases','[]')||coalesce(proposed->'aliases','[]')||jsonb_build_array(proposed->>'term')) x),'[]'),
     'citations',coalesce((select jsonb_agg(distinct x) from jsonb_array_elements(target->'citations'||proposed->'citations') x),'[]'),
     'usageNotes',coalesce((select jsonb_agg(distinct x) from jsonb_array_elements(coalesce(target->'usageNotes','[]')||coalesce(proposed->'usageNotes','[]')) x),'[]'),
     'originKeys',coalesce(target->'originKeys','[]')||coalesce(proposed->'originKeys','[]'),
     'historyKeys',coalesce(target->'historyKeys','[]')||coalesce(proposed->'historyKeys','[]'),
     'redirectIds',coalesce(target->'redirectIds','[]')||coalesce(proposed->'redirectIds','[]')||case when p_id<>p_target then jsonb_build_array(p_id) else '[]'::jsonb end);
   select jsonb_agg(case when e->>'meaningId'=p_target then updated else e end) into state.entries from jsonb_array_elements(state.entries) e;
   state.definition_overrides:=state.definition_overrides||jsonb_build_object(new_id,jsonb_build_object('definition',btrim(p_definition)));
 else raise exception 'Unknown pending glossary decision.'; end if;
 for k in select jsonb_array_elements_text(coalesce(proposed->'originKeys','[]')) loop
   state.identity_registry:=state.identity_registry||jsonb_build_object(k,new_id);
 end loop;
 update public.glossary_state set entries=state.entries,identity_registry=state.identity_registry,definition_overrides=state.definition_overrides,
   pending_entries=coalesce((select jsonb_agg(e) from jsonb_array_elements(state.pending_entries) e where e->'entry'->>'meaningId'<>p_id),'[]'),
   status='ready',error=null where id;
 perform change_control.record_source_audit('glossary_update',null,
   jsonb_build_object('operation','Reviewed','title','Glossary','total',jsonb_array_length(state.entries),'added','[]'::jsonb,'revised','[]'::jsonb,'removed','[]'::jsonb,
     'snapshot',jsonb_build_object('entries',state.entries,'inputHash',state.input_hash,'generatedAt',state.generated_at,'identityRegistry',state.identity_registry,'definitionOverrides',state.definition_overrides,
       'pendingEntries',coalesce((select jsonb_agg(e) from jsonb_array_elements(state.pending_entries) e where e->'entry'->>'meaningId'<>p_id),'[]'))),
   old_snapshot,
   'Auto Decide: “'||(proposed->>'term')||'” — '||p_reason,'ai',null);
end $$;


create function public.apply_glossary_auto_decision(p_item jsonb,p_candidates jsonb,p_decision text,p_target text,p_definition text,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $$
declare state public.glossary_state; item jsonb; candidates jsonb; target jsonb;
begin
 -- Lock the setting through commit so switching off fences in-flight decisions.
 perform 1 from public.workspace_settings where id and glossary_auto_decide for share;
 if not found then return false; end if;
 select * into state from public.glossary_state where id for update;
 if state.lease_until>now() then return false; end if;
 select e into item from jsonb_array_elements(state.pending_entries) e where e->'entry'->>'meaningId'=p_item->'entry'->>'meaningId';
 if item is null or item is distinct from p_item then return false; end if;
 select coalesce(jsonb_agg(e),'[]') into candidates from jsonb_array_elements(state.entries) e where item->'candidateIds' ? (e->>'meaningId');
 if candidates is distinct from p_candidates then return false; end if;
 if p_reason is null or length(btrim(p_reason))=0 or length(p_reason)>600 then raise exception 'A decision needs a short reason.'; end if;
 if p_decision='merge' then
   select e into target from jsonb_array_elements(candidates) e where e->>'meaningId'=p_target;
   if target is null or coalesce((target->>'keepSeparate')::boolean,false) or coalesce((item->'entry'->>'keepSeparate')::boolean,false) then raise exception 'This meaning must stay separate.'; end if;
   if coalesce((target->>'personEdited')::boolean,false) and target->>'definition' is distinct from p_definition then raise exception 'Auto Decide cannot replace a manual definition.'; end if;
 end if;
 perform change_control.apply_glossary_auto_review(item->'entry'->>'meaningId',p_decision,p_target,p_definition,p_reason);
 return true;
end $$;
revoke all on function change_control.apply_glossary_auto_review(text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.set_glossary_auto_decide(boolean),public.get_glossary_auto_decide(),public.apply_glossary_auto_decision(jsonb,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.set_glossary_auto_decide(boolean),public.get_glossary_auto_decide(),public.apply_glossary_auto_decision(jsonb,jsonb,text,text,text,text) to service_role;
notify pgrst,'reload schema';
