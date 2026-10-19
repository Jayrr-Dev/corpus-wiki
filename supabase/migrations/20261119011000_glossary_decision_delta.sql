-- One Auto Decide choice built both full dictionary copies, then the history
-- trigger compacted them again inside the same statement. That exceeded the
-- API statement limit and held the rows the status and source screens read.
-- The decision now stores the changed meanings directly. Undo still expands
-- the existing delta. A full reviewed insert keeps the trigger's checkpoint rule.

do $$
declare definition text; patched text;
begin
  definition:=pg_get_functiondef('change_control.compact_new_glossary_history()'::regprocedure);
  patched:=replace(definition,
    'if new.type::text=''glossary_update'' and new.input->>''operation''=''Reviewed'' then',
    'if current_setting(''change_control.skip_glossary_compact'', true) = ''on'' then return new; end if;
    if new.type::text=''glossary_update'' and new.input->>''operation''=''Reviewed'' then');
  if patched=definition then raise exception 'Glossary compaction trigger changed'; end if;
  execute patched;
end $$;

create or replace function change_control.apply_glossary_auto_review(p_id text,p_decision text,p_target text,p_definition text,p_reason text) returns void
language plpgsql security definer set search_path='' set jit=off as $$
declare state public.glossary_state; item jsonb; proposed jsonb; target jsonb; updated jsonb; new_id text; k text;
 before_entries jsonb; after_entries jsonb; old_pending jsonb; old_registry jsonb; old_overrides jsonb; pending jsonb;
 old_map jsonb; new_map jsonb; old_changed jsonb; new_changed jsonb; before_order jsonb; after_order jsonb;
 decision_input jsonb; decision_undo jsonb; expanded jsonb;
begin
 perform set_config('change_control.skip_glossary_compact','on',true);
 select * into state from public.glossary_state where id for update;
 if state.lease_until>now() then raise exception 'Wait for the glossary update to finish.'; end if;
 select e into item from jsonb_array_elements(state.pending_entries) e where e->'entry'->>'meaningId'=p_id;
 if item is null then raise exception 'This pending definition changed. Refresh and try again.'; end if;
 proposed:=item->'entry'; new_id:=p_id;
 before_entries:=state.entries; old_pending:=state.pending_entries; old_registry:=state.identity_registry; old_overrides:=state.definition_overrides;
 if p_decision='dismiss' then
   state.definition_overrides:=state.definition_overrides||jsonb_build_object(p_id,jsonb_build_object('deleted',true));
 elsif p_decision='keep' then
   if exists(select 1 from jsonb_array_elements(state.entries) e where e->>'meaningId'=p_id) then new_id:=gen_random_uuid()::text; end if;
   proposed:=proposed||jsonb_build_object('meaningId',new_id,'keepSeparate',true);
   select coalesce(jsonb_agg(case when exists(select 1 from jsonb_array_elements_text(coalesce(e->'originKeys','[]')) origin(value)
       where coalesce(proposed->'originKeys','[]') ? origin.value)
     then e||jsonb_build_object('originKeys',coalesce((select jsonb_agg(origin.value) from jsonb_array_elements_text(coalesce(e->'originKeys','[]')) origin(value)
       where not(coalesce(proposed->'originKeys','[]') ? origin.value)),'[]'))
     else e end order by n),'[]') into state.entries
   from jsonb_array_elements(before_entries) with ordinality t(e,n);
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
   select jsonb_agg(case when e->>'meaningId'=p_target then updated else e end order by n) into state.entries
   from jsonb_array_elements(before_entries) with ordinality t(e,n);
   state.definition_overrides:=state.definition_overrides||jsonb_build_object(new_id,jsonb_build_object('definition',btrim(p_definition)));
 else raise exception 'Unknown pending glossary decision.'; end if;
 for k in select jsonb_array_elements_text(coalesce(proposed->'originKeys','[]')) loop
   state.identity_registry:=state.identity_registry||jsonb_build_object(k,new_id);
 end loop;
 pending:=coalesce((select jsonb_agg(e) from jsonb_array_elements(old_pending) e where e->'entry'->>'meaningId'<>p_id),'[]');
 after_entries:=state.entries;
 update public.glossary_state set entries=after_entries,identity_registry=state.identity_registry,definition_overrides=state.definition_overrides,
   pending_entries=pending,status='ready',error=null where id;
 select coalesce(jsonb_object_agg(change_control.glossary_history_key(e),e),'{}'),
   coalesce(jsonb_agg(change_control.glossary_history_key(e) order by n),'[]') into old_map,before_order
 from jsonb_array_elements(before_entries) with ordinality t(e,n);
 select coalesce(jsonb_object_agg(change_control.glossary_history_key(e),e),'{}'),
   coalesce(jsonb_agg(change_control.glossary_history_key(e) order by n),'[]') into new_map,after_order
 from jsonb_array_elements(after_entries) with ordinality t(e,n);
 if (select count(*) from jsonb_object_keys(old_map))<>jsonb_array_length(before_entries)
   or (select count(*) from jsonb_object_keys(new_map))<>jsonb_array_length(after_entries) then
   raise exception 'Glossary meanings need distinct identities before Auto Decide can save history.';
 end if;
 select coalesce(jsonb_agg(e order by n),'[]') into old_changed from jsonb_array_elements(before_entries) with ordinality t(e,n)
   where e is distinct from new_map->change_control.glossary_history_key(e);
 select coalesce(jsonb_agg(e order by n),'[]') into new_changed from jsonb_array_elements(after_entries) with ordinality t(e,n)
   where e is distinct from old_map->change_control.glossary_history_key(e);
 decision_input:=jsonb_build_object('operation','Reviewed','title','Glossary','total',jsonb_array_length(after_entries),'added','[]'::jsonb,'revised','[]'::jsonb,'removed','[]'::jsonb,
   'snapshot',jsonb_build_object('entries',new_changed,'inputHash',state.input_hash,'generatedAt',state.generated_at,'identityRegistry',state.identity_registry,
     'definitionOverrides',state.definition_overrides,'pendingEntries',pending),
   'glossaryDelta',jsonb_build_object('version',1,'beforeOrder',before_order,'afterOrder',after_order,'beforeHash',md5(before_entries::text),'afterHash',md5(after_entries::text),
     'metadataPatch',jsonb_build_object('kind','object','remove','[]'::jsonb,'set',jsonb_build_object(
       'identityRegistry',jsonb_build_object('kind','value','value',old_registry),
       'definitionOverrides',jsonb_build_object('kind','value','value',old_overrides),
       'pendingEntries',jsonb_build_object('kind','value','value',old_pending)))));
 decision_undo:=jsonb_build_object('entries',old_changed,'pendingEntries',old_pending);
 expanded:=change_control.expand_glossary_history(decision_input,decision_undo,after_entries);
 if expanded->'entries' is distinct from before_entries or expanded->'pendingEntries' is distinct from old_pending
   or expanded->'identityRegistry' is distinct from old_registry or expanded->'definitionOverrides' is distinct from old_overrides then
   raise exception 'Glossary decision history verification failed; no changes were made';
 end if;
 perform change_control.record_source_audit('glossary_update',null,decision_input,decision_undo,
   'Auto Decide: “'||(proposed->>'term')||'” — '||p_reason,'ai',null);
end $$;

alter function public.complete_page_review(uuid,jsonb,jsonb,jsonb,jsonb) set jit=off;
notify pgrst,'reload schema';
