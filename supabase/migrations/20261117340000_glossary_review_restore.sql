-- Apply restored metadata in the same row update as restored entries, so the
-- audit of Undo itself also captures the correct before/after identity state.
create function change_control.restore_glossary_metadata() returns trigger
language plpgsql set search_path='' as $$
declare metadata jsonb:=nullif(current_setting('app.glossary_restore_metadata',true),'')::jsonb;
begin
 if metadata is not null and new.generated_at is distinct from old.generated_at then
   new.identity_registry:=metadata->'identityRegistry';
   new.definition_overrides:=metadata->'definitionOverrides';
   new.pending_entries:=metadata->'pendingEntries';
 end if;
 return new;
end $$;
create trigger glossary_restore_metadata before update on public.glossary_state
 for each row execute function change_control.restore_glossary_metadata();

create or replace function change_control.undo_action(p_action public.actions,p_revert_event_id uuid) returns void
language plpgsql set search_path='' as $$
begin
 if p_action.type::text='glossary_update' and p_action.undo_state ? 'identityRegistry' then
   perform set_config('app.glossary_restore_metadata',jsonb_build_object('identityRegistry',p_action.undo_state->'identityRegistry',
     'definitionOverrides',p_action.undo_state->'definitionOverrides','pendingEntries',p_action.undo_state->'pendingEntries')::text,true);
 end if;
 begin
   perform change_control.undo_action_before_meaning_identity(p_action,p_revert_event_id);
 exception when others then
   perform set_config('app.glossary_restore_metadata','',true); raise;
 end;
 perform set_config('app.glossary_restore_metadata','',true);
end $$;

-- A human review must not overwrite a target edited since it was displayed.
alter function public.resolve_glossary_pending(text,text,text,text) set schema change_control;
alter function change_control.resolve_glossary_pending(text,text,text,text) rename to resolve_glossary_pending_before_fencing;
create function public.resolve_glossary_pending(p_id text,p_decision text,p_target text default null,p_definition text default null,p_expected text default null) returns void
language plpgsql security definer set search_path='' as $$
declare target jsonb;
begin
 perform 1 from public.glossary_state where id for update;
 if p_decision='merge' then
   select e into target from public.glossary_state s cross join lateral jsonb_array_elements(s.entries) e where s.id and e->>'meaningId'=p_target;
   if p_expected is null or target is null or target->>'definition' is distinct from p_expected then
     raise exception 'The target definition changed. Refresh and compare it again.';
   end if;
 end if;
 perform change_control.resolve_glossary_pending_before_fencing(p_id,p_decision,p_target,p_definition);
end $$;
revoke all on function change_control.restore_glossary_metadata(),change_control.resolve_glossary_pending_before_fencing(text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.resolve_glossary_pending(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_glossary_pending(text,text,text,text,text) to service_role;
notify pgrst,'reload schema';
