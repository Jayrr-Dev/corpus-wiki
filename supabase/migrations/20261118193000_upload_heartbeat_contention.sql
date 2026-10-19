-- Monitoring and speculative checkpoint reads must not queue behind the
-- workflow row lock held throughout a transactional knowledge save. Actual
-- writes continue to assert and lock ownership in the same transaction.
grant create on schema public to space_runtime;
create function public.heartbeat_upload_workflow(p_event_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
declare w public.upload_workflows;
begin
  select * into w from public.upload_workflows where event_id=p_event_id;
  if w.token is distinct from p_token or w.token is null or w.state<>'running' or w.lease_until<=now() then
    raise exception 'Upload ownership expired. Resume the upload to continue.';
  end if;
  if w.cancel_requested then raise exception 'Processing was cancelled.'; end if;
  if not exists(select 1 from public.shift_events e join public.sources s on s.id=e.source_id
    where e.id=p_event_id and s.archived_at is null) then
    raise exception 'The source is archived or deleted. Restore it before resuming.';
  end if;
  -- Every foreground operation renews for five minutes. A long AI request
  -- needs renewal only once per minute; an active save already owns renewal.
  if w.lease_until < now()+interval '4 minutes' then
    perform 1 from public.upload_workflows where event_id=p_event_id for update skip locked;
    if found then perform public.assert_upload_lease(p_event_id,p_token); end if;
  end if;
end $$;
alter function public.heartbeat_upload_workflow(uuid,uuid) owner to space_runtime;
revoke all on function public.heartbeat_upload_workflow(uuid,uuid) from public,anon,authenticated;
grant execute on function public.heartbeat_upload_workflow(uuid,uuid) to service_role,space_runtime;

do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.read_completed_upload_step(uuid,uuid,text)'::regprocedure);
  if position('public.assert_upload_lease' in definition)=0 then raise exception 'Checkpoint ownership check changed'; end if;
  execute replace(definition,'public.assert_upload_lease','public.heartbeat_upload_workflow');
end $$;
revoke create on schema public from space_runtime;
notify pgrst,'reload schema';
