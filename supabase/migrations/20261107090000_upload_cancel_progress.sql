-- Uploads can be cancelled, and report how far a long role has got (batches read, sections written).
alter table public.upload_workflows
  add column cancel_requested boolean not null default false,
  add column progress jsonb;

-- A cancel stops the owner at its next lease check: between batches, between roles,
-- and on its heartbeat, which also aborts the AI call in flight.
create or replace function public.assert_upload_lease(p_event_id uuid,p_token uuid) returns void
language plpgsql set search_path='' as $$
declare w public.upload_workflows;
begin
 select * into w from public.upload_workflows where event_id=p_event_id for update;
 if w.token is distinct from p_token or w.token is null or w.state<>'running' or w.lease_until<=now() then
   raise exception 'Upload ownership expired. Resume the upload to continue.';
 end if;
 if w.cancel_requested then raise exception 'Processing was cancelled.'; end if;
 if not exists(select 1 from public.shift_events e join public.sources s on s.id=e.source_id
   where e.id=p_event_id and s.archived_at is null) then
   raise exception 'The source is archived or deleted. Restore it before resuming.';
 end if;
 update public.upload_workflows set lease_until=now()+interval '5 minutes',updated_at=now() where event_id=p_event_id;
end $$;

-- p_continue: an automatic continuation (the articles job after the knowledge job). It never
-- overrides a cancel; only a person's Resume (p_continue false) clears one.
drop function public.claim_upload_workflow(uuid);
create function public.claim_upload_workflow(p_event_id uuid,p_continue boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.upload_workflows; t uuid; prior uuid;
begin
 if not exists(select 1 from public.shift_events e join public.sources s on s.id=e.source_id
   where e.id=p_event_id and e.cause='upload' and s.archived_at is null and s.origin='internal') then
   raise exception 'Only an active internal upload can be resumed here.';
 end if;
 -- Adopt the original change set for legacy uploads; never extract committed knowledge again.
 select id into prior from public.change_sets where event_id=p_event_id order by created_at,id limit 1;
 insert into public.upload_workflows(event_id,change_set_id) values(p_event_id,prior) on conflict do nothing;
 select * into w from public.upload_workflows where event_id=p_event_id for update;
 if w.state='running' and w.lease_until>now() then
   update public.upload_workflows set resume_requested=true where event_id=p_event_id;
   return jsonb_build_object('claimed',false);
 end if;
 if public.upload_workflow_waiting(p_event_id) then
   update public.upload_workflows set state='waiting',token=null,lease_until=null where event_id=p_event_id;
   return jsonb_build_object('claimed',false);
 end if;
 if w.state='complete' then return jsonb_build_object('claimed',false); end if;
 if p_continue and w.cancel_requested then return jsonb_build_object('claimed',false); end if;
 if w.change_set_id is null and prior is not null then
   update public.upload_workflows set change_set_id=prior where event_id=p_event_id;
   w.change_set_id:=prior;
 end if;
 if exists(select 1 from public.change_sets where id=w.change_set_id and status='reverted') then
   raise exception 'The original knowledge changes were undone. Start an explicit source re-run instead.';
 end if;
 t:=gen_random_uuid();
 update public.upload_workflows set state='running',token=t,error=null,resume_requested=false,cancel_requested=false,progress=null,
 lease_until=now()+interval '5 minutes',updated_at=now() where event_id=p_event_id;
 return jsonb_build_object('claimed',true,'token',t,'changeSetId',w.change_set_id);
end $$;

create or replace function public.release_upload_workflow(p_event_id uuid,p_token uuid,p_state text,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare w public.upload_workflows; resume boolean:=false;
begin
 if p_state not in ('waiting','complete','incomplete') then raise exception 'Invalid workflow state'; end if;
 select * into w from public.upload_workflows where event_id=p_event_id for update;
 if w.token is distinct from p_token then return false; end if;
 -- An approval callback may arrive while the original request is about to pause.
 -- Hand continuation back to that owner rather than dropping the callback.
 resume:=p_state='waiting' and w.resume_requested and not public.upload_workflow_waiting(p_event_id) and not w.cancel_requested;
 -- Release still works after source archival, but an old owner cannot release a new owner's lease.
 update public.upload_workflows set state=case when resume then 'pending' else p_state end,
 error=case when w.cancel_requested then 'Processing was cancelled.' else p_error end,
 token=null,lease_until=null,progress=null,updated_at=now()
 where event_id=p_event_id and token=p_token;
 -- The roles a cancel interrupted stop showing as running
 if w.cancel_requested then
   update public.upload_steps set state='failed',error='Cancelled',updated_at=now() where event_id=p_event_id and state='running';
 end if;
 return resume;
end $$;

-- Returns 'cancelling' while the owner winds down, 'cancelled' when nothing was running
-- (a crashed owner, or articles not started yet), 'idle' when there is nothing to cancel.
create function public.cancel_upload_workflow(p_event_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare w public.upload_workflows;
begin
 select * into w from public.upload_workflows where event_id=p_event_id for update;
 if not found or w.state in ('complete','waiting') then return 'idle'; end if;
 update public.upload_workflows set cancel_requested=true,resume_requested=false,updated_at=now() where event_id=p_event_id;
 if w.state='running' and w.lease_until>now() then return 'cancelling'; end if;
 update public.upload_workflows set state='incomplete',error='Processing was cancelled.',token=null,lease_until=null,progress=null
 where event_id=p_event_id;
 update public.upload_steps set state='failed',error='Cancelled',updated_at=now() where event_id=p_event_id and state='running';
 return 'cancelled';
end $$;

-- How far the current role has got, e.g. {"step":"extraction","done":3,"total":12}
create function public.report_upload_progress(p_event_id uuid,p_token uuid,p_progress jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_upload_lease(p_event_id,p_token);
 update public.upload_workflows set progress=p_progress,updated_at=now() where event_id=p_event_id;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('assert_upload_lease','claim_upload_workflow','release_upload_workflow',
 'cancel_upload_workflow','report_upload_progress') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
