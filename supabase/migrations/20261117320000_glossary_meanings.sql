-- Meaning identity is independent of spelling and source-specific usage. JSON keeps
-- existing snapshot history/undo intact; all publication is fenced by the singleton lease.
alter table public.glossary_state
 add column pending_entries jsonb not null default '[]',
 add column identity_registry jsonb not null default '{}',
 add column definition_overrides jsonb not null default '{}';

create function change_control.glossary_legacy_key(e jsonb) returns text
language sql immutable set search_path='' as $$
 select lower(e->>'term')||'|'||coalesce(e->>'expansion','')||'|'||coalesce(e->>'scopeKey','');
$$;
create or replace function change_control.glossary_entry_key(e jsonb) returns text
language sql immutable set search_path='' as $$
 select coalesce(e->>'meaningId',change_control.glossary_legacy_key(e));
$$;
create function change_control.glossary_origin_key(e jsonb) returns text
language sql immutable set search_path='' as $$
 select change_control.glossary_legacy_key(e)||'|'||coalesce((select string_agg(id,',' order by id)
 from (select distinct c->>'unitId' id from jsonb_array_elements(e->'citations') c) units),'');
$$;

-- Adopt existing entries without changing their definitions, evidence or historical snapshots.
update public.glossary_state s set entries=coalesce((select jsonb_agg(e||jsonb_build_object(
 'meaningId',gen_random_uuid()::text,'originKeys',jsonb_build_array(change_control.glossary_origin_key(e)),
 'historyKeys',jsonb_build_array(change_control.glossary_legacy_key(e)))) from jsonb_array_elements(s.entries) e),'[]');
update public.glossary_state s set identity_registry=coalesce((select jsonb_object_agg(k,e->>'meaningId')
 from jsonb_array_elements(s.entries) e cross join lateral jsonb_array_elements_text(e->'originKeys') k),'{}');
-- Preserve current explicit human edits when cached batches are consolidated.
update public.glossary_state s set definition_overrides=coalesce((select jsonb_object_agg(e->>'meaningId',jsonb_build_object('definition',e->>'definition'))
 from jsonb_array_elements(s.entries) e where exists(select 1 from public.actions a join public.change_sets cs on cs.id=a.change_set_id
 where a.type::text='glossary_update' and cs.proposed_by='person' and a.input->'revised' ? (e->>'term')
 and exists(select 1 from jsonb_array_elements(coalesce(a.input->'snapshot'->'entries','[]')) old
 where change_control.glossary_legacy_key(old)=change_control.glossary_legacy_key(e) and old->>'definition'=e->>'definition'))),'{}');

create function change_control.validate_glossary_meanings() returns trigger
language plpgsql set search_path='' as $$
begin
 if exists(select 1 from jsonb_array_elements(new.entries) e where e ? 'meaningId') then
   if exists(select 1 from jsonb_array_elements(new.entries) e where nullif(e->>'meaningId','') is null) then
     raise exception 'Every glossary meaning needs an identity.';
   end if;
   if exists(select 1 from jsonb_array_elements(new.entries) e group by e->>'meaningId' having count(*)>1) then
     raise exception 'Duplicate glossary meaning identity.';
   end if;
   if exists(select 1 from jsonb_array_elements(new.entries) e cross join lateral jsonb_array_elements_text(coalesce(e->'originKeys','[]')) k
     group by k having count(distinct e->>'meaningId')>1) then raise exception 'One glossary origin cannot create two meanings.'; end if;
 end if;
 return new;
end $$;
create trigger glossary_meaning_identity before update of entries on public.glossary_state
 for each row execute function change_control.validate_glossary_meanings();

create function public.publish_glossary_meanings(p_token uuid,p_hash text,p_entries jsonb,p_pending jsonb,p_registry jsonb,p_batches jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare state public.glossary_state; published jsonb;
begin
 select * into state from public.glossary_state where id for update;
 if state.lease_token is distinct from p_token or state.lease_until<=clock_timestamp() or state.status<>'generating' then
   raise exception 'Another glossary generation took over. Retry to see its result.';
 end if;
 if jsonb_typeof(p_entries)<>'array' or jsonb_typeof(p_pending)<>'array' or jsonb_typeof(p_registry)<>'object' then raise exception 'Invalid glossary publication.'; end if;
 if exists(select 1 from jsonb_array_elements(p_entries) e where nullif(e->>'meaningId','') is null or jsonb_typeof(e->'usageNotes') is distinct from 'array') then
   raise exception 'Canonical meanings need stable identities and usage notes.';
 end if;
 -- Manual definitions and deletions remain authoritative, even after an expired worker resumes.
 select coalesce(jsonb_agg(case when state.definition_overrides->(e->>'meaningId') ? 'definition'
   then e||jsonb_build_object('definition',state.definition_overrides->(e->>'meaningId')->>'definition','personEdited',true) else e end),'[]')
 into published from jsonb_array_elements(p_entries) e
 where coalesce((state.definition_overrides->(e->>'meaningId')->>'deleted')::boolean,false)=false;
 update public.glossary_state set entries=published,pending_entries=p_pending,identity_registry=state.identity_registry||p_registry,
   batches=p_batches,input_hash=p_hash,generated_at=clock_timestamp(),status='ready',error=null,lease_token=null,lease_until=null where id;
end $$;

create or replace function public.edit_glossary_definition(p_original jsonb,p_definition text default null,
 p_actor public.actor_kind default 'person',p_model text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare state public.glossary_state; original jsonb; next_entries jsonb; next_batches jsonb; cs uuid; key text;
begin
 if p_definition is not null and (length(btrim(p_definition))<1 or length(p_definition)>1000) then raise exception 'Enter a definition of up to 1,000 characters.'; end if;
 select * into state from public.glossary_state where id for update;
 if state.lease_until>now() then raise exception 'Wait for the glossary update to finish.'; end if;
 key:=change_control.glossary_entry_key(p_original);
 select e into original from jsonb_array_elements(state.entries) e
 where change_control.glossary_entry_key(e)=key and e->>'definition'=p_original->>'definition';
 if original is null then raise exception 'This definition changed. Refresh and try again.'; end if;
 select coalesce(jsonb_agg(case when change_control.glossary_entry_key(e)=key then
   e||jsonb_build_object('definition',btrim(p_definition),'personEdited',true) else e end),'[]') into next_entries
 from jsonb_array_elements(state.entries) e where p_definition is not null or change_control.glossary_entry_key(e)<>key;
 -- Keep the legacy batch behaviour too, for an entry not yet migrated to canonical output.
 select coalesce(jsonb_object_agg(b.key,coalesce((select jsonb_agg(case when change_control.glossary_legacy_key(e)=change_control.glossary_legacy_key(original)
   and e->>'definition'=original->>'definition' then e||jsonb_build_object('definition',btrim(p_definition)) else e end)
   from jsonb_array_elements(b.value) e where p_definition is not null or not(change_control.glossary_legacy_key(e)=change_control.glossary_legacy_key(original)
   and e->>'definition'=original->>'definition')),'[]')),'{}') into next_batches from jsonb_each(state.batches) b;
 update public.glossary_state set entries=next_entries,batches=next_batches,error=null,status='ready',
   definition_overrides=definition_overrides||jsonb_build_object(key,case when p_definition is null then jsonb_build_object('deleted',true)
   else jsonb_build_object('definition',btrim(p_definition)) end) where id;
 cs:=change_control.record_source_audit('glossary_update',null,
   jsonb_build_object('operation','Updated','title','Glossary','total',jsonb_array_length(next_entries),'added','[]'::jsonb,
     'revised',case when p_definition is null then '[]'::jsonb else jsonb_build_array(original->>'term') end,
     'removed',case when p_definition is null then jsonb_build_array(original->>'term') else '[]'::jsonb end,
     'snapshot',jsonb_build_object('entries',next_entries,'inputHash',state.input_hash,'generatedAt',state.generated_at)),
   jsonb_build_object('entries',state.entries,'inputHash',state.input_hash,'generatedAt',state.generated_at),
   'Updated glossary: '||case when p_definition is null then 'removed ' when p_actor='ai' then 'regenerated ' else 'edited ' end||'“'||(original->>'term')||'”',p_actor,p_model);
 update public.actions a set undo_state=a.undo_state||jsonb_build_object('identityRegistry',state.identity_registry,'definitionOverrides',state.definition_overrides,'pendingEntries',state.pending_entries),
   input=jsonb_set(a.input,'{snapshot}',a.input->'snapshot'||jsonb_build_object('identityRegistry',s.identity_registry,'definitionOverrides',s.definition_overrides,'pendingEntries',s.pending_entries))
 from public.glossary_state s where a.change_set_id=cs and s.id;
 return cs;
end $$;

create function public.resolve_glossary_pending(p_id text,p_decision text,p_target text default null,p_definition text default null) returns void
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
   -- A person explicitly separated these origins from any previous interpretation.
   select coalesce(jsonb_agg(e||jsonb_build_object('originKeys',coalesce((select jsonb_agg(origin.value) from jsonb_array_elements_text(coalesce(e->'originKeys','[]')) origin(value)
     where not(coalesce(proposed->'originKeys','[]') ? origin.value)),'[]'))),'[]') into state.entries from jsonb_array_elements(state.entries) e;
   state.entries:=state.entries||jsonb_build_array(proposed);
   state.definition_overrides:=state.definition_overrides||jsonb_build_object(new_id,jsonb_build_object('separate',true));
 elsif p_decision='merge' then
   if p_definition is null or length(btrim(p_definition))<10 or length(p_definition)>1000 then raise exception 'Enter a combined definition of 10 to 1,000 characters.'; end if;
   select e into target from jsonb_array_elements(state.entries) e where e->>'meaningId'=p_target;
   if target is null or not(item->'candidateIds' ? p_target) then raise exception 'Select a current candidate meaning.'; end if;
   new_id:=p_target;
   updated:=target||jsonb_build_object('definition',btrim(p_definition),'personEdited',true,
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
   status='ready' where id;
 perform change_control.record_source_audit('glossary_update',null,
   jsonb_build_object('operation','Reviewed','title','Glossary','total',jsonb_array_length(state.entries),'added','[]'::jsonb,'revised','[]'::jsonb,'removed','[]'::jsonb,
     'snapshot',jsonb_build_object('entries',state.entries,'inputHash',state.input_hash,'generatedAt',state.generated_at,'identityRegistry',state.identity_registry,'definitionOverrides',state.definition_overrides,
       'pendingEntries',coalesce((select jsonb_agg(e) from jsonb_array_elements(state.pending_entries) e where e->'entry'->>'meaningId'<>p_id),'[]'))),
   old_snapshot,
   'Reviewed possible glossary duplicate: “'||(proposed->>'term')||'”','person',null);
end $$;

-- Extend the existing immutable audit snapshots with the identity/review metadata.
create function change_control.glossary_snapshot_metadata() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='ready' and new.generated_at is distinct from old.generated_at then
   update public.actions set undo_state=undo_state||jsonb_build_object('identityRegistry',old.identity_registry,'definitionOverrides',old.definition_overrides,'pendingEntries',old.pending_entries),
     input=jsonb_set(input,'{snapshot}',input->'snapshot'||jsonb_build_object('identityRegistry',new.identity_registry,'definitionOverrides',new.definition_overrides,'pendingEntries',new.pending_entries))
   where type::text='glossary_update' and input->'snapshot'->>'generatedAt'=to_jsonb(new.generated_at)#>>'{}' and input->'snapshot'->'entries'=new.entries;
 end if;
 return new;
end $$;
create trigger glossary_snapshot_metadata after update on public.glossary_state for each row execute function change_control.glossary_snapshot_metadata();

alter function change_control.undo_action(public.actions,uuid) rename to undo_action_before_meaning_identity;
create function change_control.undo_action(p_action public.actions,p_revert_event_id uuid) returns void
language plpgsql set search_path='' as $$
begin
 perform change_control.undo_action_before_meaning_identity(p_action,p_revert_event_id);
 if p_action.type::text='glossary_update' and p_action.undo_state ? 'identityRegistry' then
   update public.glossary_state set identity_registry=p_action.undo_state->'identityRegistry',
     definition_overrides=p_action.undo_state->'definitionOverrides',pending_entries=p_action.undo_state->'pendingEntries' where id;
 end if;
end $$;

revoke all on function change_control.glossary_legacy_key(jsonb),change_control.glossary_origin_key(jsonb),change_control.validate_glossary_meanings(),change_control.glossary_snapshot_metadata() from public,anon,authenticated;
revoke all on function change_control.undo_action(public.actions,uuid),change_control.undo_action_before_meaning_identity(public.actions,uuid) from public,anon,authenticated;
revoke all on function public.publish_glossary_meanings(uuid,text,jsonb,jsonb,jsonb,jsonb),public.resolve_glossary_pending(text,text,text,text) from public,anon,authenticated;
grant execute on function public.publish_glossary_meanings(uuid,text,jsonb,jsonb,jsonb,jsonb),public.resolve_glossary_pending(text,text,text,text) to service_role;
notify pgrst,'reload schema';
