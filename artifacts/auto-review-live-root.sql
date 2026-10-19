CREATE OR REPLACE FUNCTION change_control.apply_glossary_auto_review(p_id text, p_decision text, p_target text, p_definition text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     'citations',coalesce((select jsonb_agg(distinct x) from jsonb_array_elements(coalesce(target->'citations','[]'::jsonb)||coalesce(proposed->'citations','[]'::jsonb)) x),'[]'),
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
end $function$
