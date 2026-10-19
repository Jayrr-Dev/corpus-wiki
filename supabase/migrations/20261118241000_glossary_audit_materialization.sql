-- Keep glossary publication within the request deadline without changing audit snapshots.
-- These JSON snapshots have hundreds of entries; compiling nested trigger queries
-- costs more than executing them and can exhaust the API's eight-second budget.
alter function public.publish_glossary_meanings(uuid,text,jsonb,jsonb,jsonb,jsonb) set jit=off;
create or replace function change_control.audit_glossary() returns trigger
language plpgsql security definer set search_path='' set jit=off as $$
declare cs uuid; ev uuid; model text; usage_in bigint; usage_out bigint; added jsonb; revised jsonb; removed jsonb;
 actor public.actor_kind:='ai'; verb text; summary text; previous jsonb; current_snapshot jsonb;
begin
 if new.status<>'ready' or new.generated_at is not distinct from old.generated_at then return new; end if;
 -- Materialize each toasted snapshot and its identity keys once. Re-evaluating
 -- jsonb_array_elements(OLD.entries) per new meaning can exceed the API deadline.
 with old_entries as materialized (
   select e,change_control.glossary_entry_key(e) key from jsonb_array_elements(old.entries) e
 ), new_entries as materialized (
   select e,change_control.glossary_entry_key(e) key from jsonb_array_elements(new.entries) e
 )
 select
   coalesce((select jsonb_agg(n.e->>'term') from new_entries n where not exists(select 1 from old_entries o where o.key=n.key)),'[]'),
   coalesce((select jsonb_agg(n.e->>'term') from new_entries n where exists(select 1 from old_entries o where o.key=n.key and o.e is distinct from n.e)),'[]'),
   coalesce((select jsonb_agg(o.e->>'term') from old_entries o where not exists(select 1 from new_entries n where n.key=o.key)),'[]')
 into added,revised,removed;
 if current_setting('app.glossary_undo',true)='true' then actor:='person'; end if;
 if actor='ai' then
   select c.model into model from public.ai_calls c where c.purpose='glossary_dictionary'
     and c.created_at>=coalesce(new.generation_started_at,old.generated_at,'epoch') order by c.created_at desc limit 1;
   select sum(prompt_tokens),sum(completion_tokens) into usage_in,usage_out from public.ai_calls c
     where c.purpose='glossary_dictionary' and c.created_at>=coalesce(new.generation_started_at,old.generated_at,'epoch');
 end if;
 verb:=case when actor='person' then 'Restored' when old.generated_at is null then 'Generated' else 'Updated' end;
 summary:=verb||' glossary: '||jsonb_array_length(new.entries)||' definitions ('||jsonb_array_length(added)||' added, '||jsonb_array_length(revised)||' revised, '||jsonb_array_length(removed)||' removed)';
 previous:=jsonb_build_object('entries',old.entries,'inputHash',old.input_hash,'generatedAt',old.generated_at,'identityRegistry',old.identity_registry,'definitionOverrides',old.definition_overrides,'pendingEntries',old.pending_entries);
 current_snapshot:=jsonb_build_object('entries',new.entries,'inputHash',new.input_hash,'generatedAt',new.generated_at,'identityRegistry',new.identity_registry,'definitionOverrides',new.definition_overrides,'pendingEntries',new.pending_entries);
 insert into public.shift_events(cause,actor,status,finished_at) values('edit',actor,'applied',now()) returning id into ev;
 insert into public.change_sets(event_id,proposed_by,status,summary,model_version,prompt_version,tokens_in,tokens_out,applied_at,actor_attribution)
 values(ev,actor,'applied',summary,model,'dictionary-v1',usage_in,usage_out,now(),
   case when actor='ai' then jsonb_build_object('proposedBy',jsonb_build_object('role','Dictionary editor','model',model)) else null end) returning id into cs;
 insert into public.actions(change_set_id,position,type,input,undo_state,outcome,applied_at)
 values(cs,0,'glossary_update',jsonb_build_object('operation',verb,'title','Glossary','total',jsonb_array_length(new.entries),
   'added',added,'revised',revised,'removed',removed,'snapshot',current_snapshot),previous,'applied',now());
 return new;
end $$;

