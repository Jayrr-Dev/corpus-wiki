-- Read only the targets produced by this leased workflow's own audited write.
-- Ownership changes require CREATE for the new owner. The runner wraps this
-- entire migration in one transaction, so the temporary grant is never exposed.
grant create on schema public to space_runtime;
-- Legacy adoption must not mistake the first early batch for the final whole-file
-- reconciliation, or a resume could skip all remaining extraction.
do $$ declare definition text; patched text; begin
  definition:=pg_get_functiondef('public.claim_upload_workflow(uuid,boolean)'::regprocedure);
  patched:=replace(definition,
    'select id into prior from public.change_sets where event_id=p_event_id order by created_at,id limit 1;',
    $replacement$select c.id into prior from public.change_sets c where c.event_id=p_event_id
      and not exists(select 1 from public.upload_writes batch_write where batch_write.event_id=p_event_id
        and batch_write.function_name='submit_change_set' and batch_write.key like 'extract-save:%' and batch_write.result->>'changeSetId'=c.id::text)
      order by c.created_at,c.id limit 1;$replacement$);
  if patched=definition then raise exception 'Upload adoption query changed; review incremental migration'; end if;
  execute patched;
end $$;

create function public.read_completed_upload_step(p_event_id uuid,p_token uuid,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_upload_lease(p_event_id,p_token);
  return coalesce((select jsonb_build_object('done',true,'output',s.output) from public.upload_steps s
    where s.event_id=p_event_id and s.key=p_key and s.state='succeeded'),jsonb_build_object('done',false));
end $$;

create function public.read_upload_batch_targets(p_event_id uuid,p_token uuid,p_change_set_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_upload_lease(p_event_id,p_token);
  if not exists(select 1 from public.upload_writes where event_id=p_event_id
    and function_name='submit_change_set' and key like 'extract-save:%'
    and result->>'changeSetId'=p_change_set_id::text) then
    raise exception 'Batch does not belong to this upload';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('position',a.position,'unitId',a.target_id,
    'type',a.type,'outcome',a.outcome) order by a.position),'[]'::jsonb)
    from public.actions a where a.change_set_id=p_change_set_id);
end $$;

-- Undo the final reconciliation and its early batches together. Ordinary change
-- sets still use the existing undo implementation and all its conflict checks.
create function public.revert_upload_knowledge(p_change_set_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; batch record; upload_event uuid;
begin
  select event_id into upload_event from public.upload_workflows where change_set_id=p_change_set_id;
  result:=public.revert_change_set(p_change_set_id);
  if upload_event is not null then
    for batch in select c.id from public.upload_writes w join public.change_sets c on c.id=(w.result->>'changeSetId')::uuid
      where w.event_id=upload_event and w.function_name='submit_change_set' and w.key like 'extract-save:%'
      and c.status in ('applied','partly_applied') order by c.created_at desc,c.id desc loop
      perform public.revert_change_set(batch.id);
    end loop;
  end if;
  return result;
end $$;

revoke all on function public.read_upload_batch_targets(uuid,uuid,uuid),public.revert_upload_knowledge(uuid),public.read_completed_upload_step(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.read_upload_batch_targets(uuid,uuid,uuid),public.revert_upload_knowledge(uuid),public.read_completed_upload_step(uuid,uuid,text) to service_role,space_runtime;
alter function public.read_completed_upload_step(uuid,uuid,text) owner to space_runtime;
alter function public.read_upload_batch_targets(uuid,uuid,uuid) owner to space_runtime;
alter function public.revert_upload_knowledge(uuid) owner to space_runtime;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
