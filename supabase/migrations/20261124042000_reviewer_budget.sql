-- =====================================================================
-- REVIEWER BUDGET (issue #42): a very large upload asks a person before
-- its pages are written. After the plan stage the upload estimates the
-- Reviewer calls its article build needs (lib/living-page/reviewerBudget.ts).
-- Over the budget it holds one marker action, approve_reviewer_budget,
-- as an Exception with reason reviewer_budget, and the upload waits.
--   hold_upload_for_reviewer_budget  asks once per upload; later calls
--                                    return the answer (approved,
--                                    declined) or waiting
--   upload_workflow_waiting          also true while that question is open
--   resolve_exception                accept: the upload wakes and writes
--                                    its pages; decline: the upload stops
--                                    with the reason as its error
--   queue_upload_recovery            a declined upload is not retried
--                                    in the background
--   undo_action                      the marker changes no content, so
--                                    Undo only marks it reverted
-- =====================================================================

alter type public.action_type add value if not exists 'approve_reviewer_budget';
alter type public.exception_reason add value if not exists 'reviewer_budget';

grant create on schema public to space_runtime;
grant create on schema change_control to space_runtime;


-- =====================================================================
-- 1. HOLD: one question per upload, asked by the run that holds the lease
-- =====================================================================

create function public.hold_upload_for_reviewer_budget(p_event_id uuid,p_token uuid,p_sections integer,p_estimate integer,p_budget integer) returns text
language plpgsql security definer set search_path='' as $$
declare held public.exceptions; submitted jsonb; cs uuid; a uuid;
begin
 if not exists(select 1 from public.upload_workflows where event_id=p_event_id and token=p_token) then
   raise exception 'This upload is no longer running here.';
 end if;
 perform pg_advisory_xact_lock(hashtext('reviewer-budget:'||p_event_id::text));
 select e.* into held from public.exceptions e join public.actions act on act.id=e.action_id
   join public.change_sets s on s.id=act.change_set_id
   where s.event_id=p_event_id and e.reason::text='reviewer_budget' order by e.created_at desc limit 1;
 if held.id is not null then
   return case held.status::text when 'accepted' then 'approved' when 'rejected' then 'declined' else 'waiting' end;
 end if;
 submitted:=public.submit_change_set(p_event_id,'upload','ai','Reviewer budget: '||p_sections||' sections to write','{}','[]');
 cs:=(submitted->>'changeSetId')::uuid;
 insert into public.actions(change_set_id,position,type,input,outcome)
   values(cs,0,'approve_reviewer_budget',jsonb_build_object('sections',p_sections,'estimate',p_estimate,'budget',p_budget,
     'reason','Write pages for '||p_sections||' sections, about '||p_estimate||' Reviewer calls (budget '||p_budget||').'),'exception')
   returning id into a;
 insert into public.exceptions(action_id,reason,evidence) values(a,'reviewer_budget',jsonb_build_object('detail',
   'This upload would write '||p_sections||' sections, about '||p_estimate||' Reviewer calls, over the budget of '||p_budget||
   '. Accept to write its pages. Decline to stop the upload before any pages are written; its knowledge stays saved.'));
 perform change_control.refresh_status(cs);
 return 'waiting';
end $$;


-- =====================================================================
-- 2. WAIT: the upload counts as waiting while the question is open
-- =====================================================================

alter function public.upload_workflow_waiting(uuid) rename to upload_waiting_before_reviewer_budget;
create function public.upload_workflow_waiting(p_event_id uuid) returns boolean
language sql stable set search_path='' as $$
 select public.upload_waiting_before_reviewer_budget(p_event_id) or exists(
   select 1 from public.exceptions e join public.actions a on a.id=e.action_id join public.change_sets s on s.id=a.change_set_id
   where s.event_id=p_event_id and e.reason::text='reviewer_budget' and e.status='open')
$$;


-- =====================================================================
-- 3. ANSWER: accept wakes the upload (through wake_approved_upload);
-- decline stops it with the reason. A run still holding the lease is
-- asked to continue, so it reads the answer instead of waiting forever.
-- =====================================================================

alter function public.resolve_exception(uuid,boolean,text) rename to resolve_before_reviewer_budget;
create function public.resolve_exception(p_exception_id uuid,p_accept boolean,p_note text) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare x public.exceptions; a public.actions; s public.change_sets; desired text:=case when p_accept then 'accepted' else 'rejected' end;
begin
 select * into x from public.exceptions where id=p_exception_id;
 if x.reason::text is distinct from 'reviewer_budget' then
   return public.resolve_before_reviewer_budget(p_exception_id,p_accept,p_note);
 end if;
 select * into a from public.actions where id=x.action_id;
 select * into s from public.change_sets where id=a.change_set_id for update;
 select * into x from public.exceptions where id=p_exception_id for update;
 if x.status::text<>'open' then
   if x.status::text<>desired then raise exception 'This exception already has a different answer.'; end if;
   return jsonb_build_object('eventId',s.event_id);
 end if;
 update public.exceptions set status=desired::public.exception_status,resolved_at=now(),note=p_note where id=x.id;
 update public.actions set outcome=case when p_accept then 'applied' else 'rejected' end::public.action_outcome,
   applied_at=case when p_accept then now() end where id=a.id;
 perform change_control.refresh_status(s.id);
 update public.upload_workflows set resume_requested=true,updated_at=now() where event_id=s.event_id and state='running';
 if not p_accept then
   update public.upload_workflows set state='incomplete',updated_at=now(),
     error='Writing pages was declined: about '||(a.input->>'estimate')||' Reviewer calls for '||(a.input->>'sections')||
       ' sections is over the budget of '||(a.input->>'budget')||'.'
     where event_id=s.event_id and state='waiting' and not cancel_requested;
 end if;
 return jsonb_build_object('eventId',s.event_id);
end $$;

-- A declined build is not retried in the background (Resume runs it again and stops with the same reason)
create or replace function change_control.queue_upload_recovery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.cancel_requested or new.state in ('complete','waiting') or exists(
   select 1 from public.exceptions e join public.actions a on a.id=e.action_id join public.change_sets c on c.id=a.change_set_id
   where c.event_id=new.event_id and e.reason::text='reviewer_budget' and e.status='rejected') then
   delete from public.upload_recovery_jobs where event_id=new.event_id; return new;
 end if;
 if not exists(select 1 from public.shift_events e join public.sources s on s.id=e.source_id
   where e.id=new.event_id and e.cause='upload' and s.origin='internal' and s.archived_at is null) then return new; end if;
 insert into public.upload_recovery_jobs(event_id,available_at)
 values(new.event_id,case when new.state='running' then coalesce(new.lease_until,now()) else now()+interval '15 seconds' end)
 on conflict(event_id) do update set available_at=case when upload_recovery_jobs.token is null then excluded.available_at else upload_recovery_jobs.available_at end,
   attempts=case when new.state='running' and upload_recovery_jobs.token is null then 0 else upload_recovery_jobs.attempts end;
 return new;
end $$;

-- An accepted budget wakes its upload, as a final root approval does
create or replace function change_control.wake_approved_upload() returns trigger language plpgsql security definer set search_path='' as $$
declare event uuid;
begin
 if old.status<>'open' or new.status='open' or new.reason::text not in ('root_domain_approval','reviewer_budget') then return new; end if;
 if new.reason::text='reviewer_budget' and new.status::text<>'accepted' then return new; end if;
 select c.event_id into event from public.actions a join public.change_sets c on c.id=a.change_set_id where a.id=new.action_id;
 if event is not null and not public.upload_workflow_waiting(event) then
   update public.upload_workflows set state='pending',updated_at=now() where event_id=event and state='waiting' and not cancel_requested;
 end if;
 return new;
end $$;


-- =====================================================================
-- 4. UNDO: the marker changed nothing, so undoing it changes nothing
-- =====================================================================

alter function change_control.undo_action(public.actions,uuid) rename to undo_action_before_reviewer_budget;
create function change_control.undo_action(p_action public.actions,p_revert_event_id uuid) returns void
language plpgsql set search_path='' as $$
begin
 if p_action.type::text='approve_reviewer_budget' then
   update public.actions set outcome='reverted',reverted_by_event_id=p_revert_event_id where id=p_action.id;
 else perform change_control.undo_action_before_reviewer_budget(p_action,p_revert_event_id); end if;
end $$;


-- =====================================================================
-- ACCESS: the same owners and grants as the functions they wrap
-- =====================================================================

revoke all on function public.hold_upload_for_reviewer_budget(uuid,uuid,integer,integer,integer),
  public.upload_waiting_before_reviewer_budget(uuid),
  public.resolve_exception(uuid,boolean,text),public.resolve_before_reviewer_budget(uuid,boolean,text) from public,anon,authenticated;
revoke execute on function change_control.undo_action(public.actions,uuid),
  change_control.undo_action_before_reviewer_budget(public.actions,uuid) from public,anon,authenticated;
grant execute on function public.hold_upload_for_reviewer_budget(uuid,uuid,integer,integer,integer),
  public.resolve_exception(uuid,boolean,text) to service_role;
grant execute on function public.upload_workflow_waiting(uuid),public.upload_waiting_before_reviewer_budget(uuid) to service_role,space_runtime;
grant execute on function change_control.undo_action(public.actions,uuid),
  change_control.undo_action_before_reviewer_budget(public.actions,uuid) to service_role,space_runtime;
alter function public.hold_upload_for_reviewer_budget(uuid,uuid,integer,integer,integer) owner to space_runtime;
alter function public.upload_workflow_waiting(uuid) owner to space_runtime;
alter function public.resolve_exception(uuid,boolean,text) owner to space_runtime;
alter function change_control.undo_action(public.actions,uuid) owner to space_runtime;
revoke create on schema public from space_runtime;
revoke create on schema change_control from space_runtime;
notify pgrst,'reload schema';
