alter table public.glossary_state add column generation_started_at timestamptz;

create or replace function public.claim_glossary_generation(p_hash text,p_force boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid:=gen_random_uuid(); claimed uuid;
begin
 update public.glossary_state set lease_token=token,lease_until=now()+interval '10 minutes',
   generation_started_at=now(),status='generating',error=null,completed_batches=0
 where id and (lease_until is null or lease_until<now())
   and (p_force or input_hash is distinct from p_hash or status<>'ready')
 returning lease_token into claimed;
 return claimed;
end $$;

create function change_control.glossary_entry_key(e jsonb) returns text
language sql immutable set search_path='' as $$
 select lower(e->>'term')||'|'||coalesce(e->>'expansion','')||'|'||coalesce(e->>'scopeKey','');
$$;

create function change_control.audit_glossary() returns trigger
language plpgsql security definer set search_path='' as $$
declare cs uuid; ev uuid; model text; usage_in bigint; usage_out bigint; added jsonb; revised jsonb; removed jsonb;
 actor public.actor_kind:='ai'; verb text; summary text; previous jsonb; current_snapshot jsonb;
begin
 if new.status<>'ready' or new.generated_at is not distinct from old.generated_at then return new; end if;
 select coalesce(jsonb_agg(e->>'term'),'[]') into added from jsonb_array_elements(new.entries) e
   where not exists(select 1 from jsonb_array_elements(old.entries) o where change_control.glossary_entry_key(o)=change_control.glossary_entry_key(e));
 select coalesce(jsonb_agg(e->>'term'),'[]') into revised from jsonb_array_elements(new.entries) e
   where exists(select 1 from jsonb_array_elements(old.entries) o where change_control.glossary_entry_key(o)=change_control.glossary_entry_key(e) and o is distinct from e);
 select coalesce(jsonb_agg(e->>'term'),'[]') into removed from jsonb_array_elements(old.entries) e
   where not exists(select 1 from jsonb_array_elements(new.entries) o where change_control.glossary_entry_key(o)=change_control.glossary_entry_key(e));
 if current_setting('app.glossary_undo',true)='true' then actor:='person'; end if;
 if actor='ai' then
   select c.model into model from public.ai_calls c where c.purpose='glossary_dictionary'
     and c.created_at>=coalesce(new.generation_started_at,old.generated_at,'epoch') order by c.created_at desc limit 1;
   select sum(prompt_tokens),sum(completion_tokens) into usage_in,usage_out from public.ai_calls c
     where c.purpose='glossary_dictionary' and c.created_at>=coalesce(new.generation_started_at,old.generated_at,'epoch');
 end if;
 verb:=case when actor='person' then 'Restored' when old.generated_at is null then 'Generated' else 'Updated' end;
 summary:=verb||' glossary: '||jsonb_array_length(new.entries)||' definitions ('||jsonb_array_length(added)||' added, '||jsonb_array_length(revised)||' revised, '||jsonb_array_length(removed)||' removed)';
 previous:=jsonb_build_object('entries',old.entries,'inputHash',old.input_hash,'generatedAt',old.generated_at);
 current_snapshot:=jsonb_build_object('entries',new.entries,'inputHash',new.input_hash,'generatedAt',new.generated_at);
 insert into public.shift_events(cause,actor,status,finished_at) values('edit',actor,'applied',now()) returning id into ev;
 insert into public.change_sets(event_id,proposed_by,status,summary,model_version,prompt_version,tokens_in,tokens_out,applied_at,actor_attribution)
 values(ev,actor,'applied',summary,model,'dictionary-v1',usage_in,usage_out,now(),
   case when actor='ai' then jsonb_build_object('proposedBy',jsonb_build_object('role','Dictionary editor','model',model)) else null end) returning id into cs;
 insert into public.actions(change_set_id,position,type,input,undo_state,outcome,applied_at)
 values(cs,0,'glossary_update',jsonb_build_object('operation',verb,'title','Glossary','total',jsonb_array_length(new.entries),
   'added',added,'revised',revised,'removed',removed,'snapshot',current_snapshot),previous,'applied',now());
 return new;
end $$;
create trigger glossary_audit after update on public.glossary_state for each row execute function change_control.audit_glossary();

alter function change_control.undo_action(public.actions,uuid) rename to undo_action_before_glossary;
create function change_control.undo_action(p_action public.actions,p_revert_event_id uuid)
returns void language plpgsql set search_path='' as $$
declare current_state public.glossary_state;
begin
 if p_action.type::text<>'glossary_update' then
   perform change_control.undo_action_before_glossary(p_action,p_revert_event_id); return;
 end if;
 select * into current_state from public.glossary_state where id for update;
 if current_state.lease_until>now() then raise exception 'Wait for dictionary generation to finish before undoing it.'; end if;
 if current_state.entries is distinct from p_action.input->'snapshot'->'entries' then
   raise exception 'The dictionary changed later. Undo its later update first.';
 end if;
 perform set_config('app.glossary_undo','true',true);
 -- Keep the current input hash, so opening the dictionary does not immediately undo the person's choice.
 update public.glossary_state set entries=p_action.undo_state->'entries',generated_at=clock_timestamp(),status='ready',error=null where id;
 perform set_config('app.glossary_undo','false',true);
 update public.actions set outcome='reverted',reverted_by_event_id=p_revert_event_id where id=p_action.id;
end $$;

-- Adopt an already-generated dictionary into Changes without re-running its AI calls.
do $$ declare state public.glossary_state;
begin
 select * into state from public.glossary_state where id;
 if state.generated_at is not null then
   update public.glossary_state set status='idle',entries='[]',generated_at=null where id;
   update public.glossary_state set status='ready',entries=state.entries,generated_at=state.generated_at where id;
 end if;
end $$;
revoke all on function change_control.audit_glossary() from public,anon,authenticated;
revoke all on function change_control.glossary_entry_key(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
