-- Reversible deltas: keep history and Undo without copying the whole dictionary
-- twice for every reviewed meaning. No data backfill runs in this migration.
create index actions_glossary_history_order on public.actions(space_id,created_at desc,id desc)
 where type='glossary_update';
create function change_control.history_restore_patch(p_before jsonb,p_after jsonb) returns jsonb
language plpgsql immutable set search_path='' set jit=off as $$
declare changes jsonb:='{}'; removed jsonb; k text; v jsonb; patch jsonb;
begin
 if p_before is not distinct from p_after then return null; end if;
 if jsonb_typeof(p_before)='object' and jsonb_typeof(p_after)='object' then
  for k,v in select key,value from jsonb_each(p_before) loop
   patch:=change_control.history_restore_patch(v,p_after->k);
   if patch is not null then changes:=changes||jsonb_build_object(k,patch); end if;
  end loop;
  select coalesce(jsonb_agg(key),'[]') into removed from jsonb_object_keys(p_after) key where not p_before ? key;
  return jsonb_build_object('kind','object','set',changes,'remove',removed);
 elsif jsonb_typeof(p_before)='array' and jsonb_typeof(p_after)='array' then
  for k,v in select (ordinality-1)::text,value from jsonb_array_elements(p_before) with ordinality loop
   patch:=change_control.history_restore_patch(v,p_after->(k::integer));
   if patch is not null then changes:=changes||jsonb_build_object(k,patch); end if;
  end loop;
  return jsonb_build_object('kind','array','length',jsonb_array_length(p_before),'set',changes);
 end if;
 return jsonb_build_object('kind','value','value',p_before);
end $$;

create function change_control.history_apply_patch(p_after jsonb,p_patch jsonb) returns jsonb
language plpgsql immutable set search_path='' set jit=off as $$
declare result jsonb; k text; v jsonb; i integer;
begin
 if p_patch is null then return p_after; end if;
 case p_patch->>'kind'
 when 'value' then return p_patch->'value';
 when 'object' then
  result:=p_after;
  for k in select jsonb_array_elements_text(p_patch->'remove') loop result:=result-k; end loop;
  for k,v in select key,value from jsonb_each(p_patch->'set') loop
   result:=jsonb_set(result,array[k],change_control.history_apply_patch(p_after->k,v),true);
  end loop;
  return result;
 when 'array' then
  result:='[]';
  for i in 0..((p_patch->>'length')::integer-1) loop
   result:=result||jsonb_build_array(change_control.history_apply_patch(p_after->i,p_patch->'set'->i::text));
  end loop;
  return result;
 else raise exception 'Unknown glossary history patch format';
 end case;
end $$;

create function change_control.glossary_history_key(p_entry jsonb) returns text
language sql immutable set search_path='' as $$
 select coalesce(p_entry->>'meaningId',change_control.glossary_entry_key(p_entry));
$$;

create function change_control.expand_glossary_history(p_input jsonb,p_undo jsonb,p_entries jsonb) returns jsonb
language plpgsql immutable set search_path='' set jit=off as $$
declare delta jsonb:=p_input->'glossaryDelta'; lookup jsonb; restored jsonb; metadata jsonb;
begin
 if delta is null then return p_undo; end if;
 if delta->>'version'<>'1' then raise exception 'Unknown glossary history version'; end if;
 if md5(p_entries::text) is distinct from delta->>'afterHash' then
  raise exception 'The dictionary changed later. Undo its later update first.';
 end if;
 select coalesce(jsonb_object_agg(change_control.glossary_history_key(e),e order by n),'{}') into lookup
 from jsonb_array_elements(p_entries||(p_undo->'entries')) with ordinality t(e,n);
 select coalesce(jsonb_agg(lookup->k order by n),'[]') into restored
 from jsonb_array_elements_text(delta->'beforeOrder') with ordinality t(k,n);
 if md5(restored::text) is distinct from delta->>'beforeHash' then
  raise exception 'Glossary history verification failed; no changes were made';
 end if;
 metadata:=change_control.history_apply_patch((p_input->'snapshot')-'entries',nullif(delta->'metadataPatch','null'));
 return metadata||jsonb_build_object('entries',restored);
end $$;

create function change_control.compact_glossary_history(p_input jsonb,p_undo jsonb) returns jsonb
language plpgsql immutable set search_path='' set jit=off as $$
declare before_entries jsonb:=p_undo->'entries'; after_entries jsonb:=p_input->'snapshot'->'entries';
 old_map jsonb; new_map jsonb; old_changed jsonb; new_changed jsonb; ordering jsonb; after_order jsonb;
 next_input jsonb; next_undo jsonb; expanded jsonb; delta jsonb;
begin
 if p_input ? 'glossaryDelta' or jsonb_typeof(before_entries) is distinct from 'array'
  or jsonb_typeof(after_entries) is distinct from 'array' then return jsonb_build_object('input',p_input,'undo_state',p_undo); end if;
 select coalesce(jsonb_object_agg(change_control.glossary_history_key(e),e),'{}'),
  coalesce(jsonb_agg(change_control.glossary_history_key(e) order by n),'[]') into old_map,ordering
 from jsonb_array_elements(before_entries) with ordinality t(e,n);
 select coalesce(jsonb_object_agg(change_control.glossary_history_key(e),e),'{}'),
  coalesce(jsonb_agg(change_control.glossary_history_key(e) order by n),'[]') into new_map,after_order
 from jsonb_array_elements(after_entries) with ordinality t(e,n);
 -- Ambiguous legacy identities stay as full checkpoints.
 if (select count(*) from jsonb_object_keys(old_map))<>jsonb_array_length(before_entries)
  or (select count(*) from jsonb_object_keys(new_map))<>jsonb_array_length(after_entries) then
  return jsonb_build_object('input',p_input,'undo_state',p_undo);
 end if;
 select coalesce(jsonb_agg(e order by n),'[]') into old_changed
 from jsonb_array_elements(before_entries) with ordinality t(e,n) where e is distinct from new_map->change_control.glossary_history_key(e);
 select coalesce(jsonb_agg(e order by n),'[]') into new_changed
 from jsonb_array_elements(after_entries) with ordinality t(e,n) where e is distinct from old_map->change_control.glossary_history_key(e);
 delta:=jsonb_build_object('version',1,'beforeOrder',ordering,'afterOrder',after_order,'beforeHash',md5(before_entries::text),'afterHash',md5(after_entries::text),
  'metadataPatch',change_control.history_restore_patch(p_undo-'entries',(p_input->'snapshot')-'entries'));
 next_input:=jsonb_set(p_input,'{snapshot,entries}',new_changed)||jsonb_build_object('glossaryDelta',delta);
 next_undo:=jsonb_build_object('entries',old_changed);
 expanded:=change_control.expand_glossary_history(next_input,next_undo,after_entries);
 if expanded is distinct from p_undo then raise exception 'Glossary compaction round-trip failed'; end if;
 if octet_length(next_input::text)+octet_length(next_undo::text)>=octet_length(p_input::text)+octet_length(p_undo::text) then
  return jsonb_build_object('input',p_input,'undo_state',p_undo);
 end if;
 return jsonb_build_object('input',next_input,'undo_state',next_undo);
end $$;

-- Keep the newest twenty full records per space. Each insert compacts at most
-- one older record; roughly one in sixteen remains a full checkpoint.
create function change_control.compact_new_glossary_history() returns trigger
language plpgsql set search_path='' set jit=off as $$
declare compacted jsonb; previous public.actions;
begin
 if new.type::text='glossary_update' then
  select a.* into previous from public.actions a where a.type='glossary_update' and a.space_id=new.space_id
   order by a.created_at desc,a.id desc offset 19 limit 1 for update;
  if found and right(previous.id::text,1)<>'0' and not previous.input ? 'glossaryDelta' then
   compacted:=change_control.compact_glossary_history(previous.input,previous.undo_state);
   update public.actions set input=compacted->'input',undo_state=compacted->'undo_state' where id=previous.id;
  end if;
 end if;
 return new;
end $$;
create trigger compact_glossary_history before insert on public.actions
 for each row execute function change_control.compact_new_glossary_history();

-- Hydrate the action in memory before entering the existing Undo chain. Scope
-- stays with the invoking runtime and its existing RLS policies.
alter function change_control.undo_action(public.actions,uuid) rename to undo_action_before_glossary_delta;
create function change_control.undo_action(p_action public.actions,p_revert_event_id uuid) returns void
language plpgsql set search_path='' set jit=off as $$
declare entries jsonb;
begin
 if p_action.type::text='glossary_update' and p_action.input ? 'glossaryDelta' then
  select s.entries into entries from public.glossary_state s where s.id and s.space_id=p_action.space_id for update;
  if not found then raise exception 'Dictionary not found in this space'; end if;
  p_action.undo_state:=change_control.expand_glossary_history(p_action.input,p_action.undo_state,entries);
  p_action.input:=jsonb_set(p_action.input,'{snapshot,entries}',entries);
 end if;
 perform change_control.undo_action_before_glossary_delta(p_action,p_revert_event_id);
end $$;

revoke all on function change_control.history_restore_patch(jsonb,jsonb),change_control.history_apply_patch(jsonb,jsonb),
 change_control.glossary_history_key(jsonb),change_control.expand_glossary_history(jsonb,jsonb,jsonb),
 change_control.compact_glossary_history(jsonb,jsonb),change_control.compact_new_glossary_history(),
 change_control.undo_action(public.actions,uuid),change_control.undo_action_before_glossary_delta(public.actions,uuid) from public,anon,authenticated;
grant execute on function change_control.history_restore_patch(jsonb,jsonb),change_control.history_apply_patch(jsonb,jsonb),
 change_control.glossary_history_key(jsonb),change_control.expand_glossary_history(jsonb,jsonb,jsonb),
 change_control.compact_glossary_history(jsonb,jsonb),change_control.compact_new_glossary_history(),
 change_control.undo_action(public.actions,uuid),change_control.undo_action_before_glossary_delta(public.actions,uuid) to service_role,space_runtime;
grant create on schema change_control to space_runtime;
alter function change_control.undo_action(public.actions,uuid) owner to space_runtime;
revoke create on schema change_control from space_runtime;
