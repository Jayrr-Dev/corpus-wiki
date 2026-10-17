-- Persistent dispatch, separate from the upload's own write-fencing lease.
create table public.upload_recovery_jobs (
 event_id uuid primary key references public.upload_workflows(event_id) on delete cascade,
 available_at timestamptz not null default now(), attempts integer not null default 0,
 token uuid, lease_until timestamptz, progress_count integer not null default 0, last_error text
);
create index upload_recovery_due_idx on public.upload_recovery_jobs(available_at) where attempts<3;
alter table public.upload_recovery_jobs enable row level security;
grant all on public.upload_recovery_jobs to service_role;

create function change_control.queue_upload_recovery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.cancel_requested or new.state in ('complete','waiting') then
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
create trigger queue_upload_recovery after insert or update of state,cancel_requested on public.upload_workflows
 for each row execute function change_control.queue_upload_recovery();

-- A final approval durably wakes the upload even if its HTTP callback exits.
create function change_control.wake_approved_upload() returns trigger language plpgsql security definer set search_path='' as $$
declare event uuid;
begin
 if old.status<>'open' or new.status='open' or new.reason::text<>'root_domain_approval' then return new; end if;
 select c.event_id into event from public.actions a join public.change_sets c on c.id=a.change_set_id where a.id=new.action_id;
 if event is not null and not public.upload_workflow_waiting(event) then
   update public.upload_workflows set state='pending',updated_at=now() where event_id=event and state='waiting' and not cancel_requested;
 end if;
 return new;
end $$;
create trigger wake_approved_upload after update of status on public.exceptions for each row execute function change_control.wake_approved_upload();

insert into public.upload_recovery_jobs(event_id,available_at)
select w.event_id,case when w.state='running' then coalesce(w.lease_until,now()) else now()+interval '15 seconds' end
from public.upload_workflows w join public.shift_events e on e.id=w.event_id join public.sources s on s.id=e.source_id
where not w.cancel_requested and w.state in ('pending','running','incomplete') and e.cause='upload' and s.origin='internal' and s.archived_at is null;

create function public.claim_upload_recovery() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.upload_recovery_jobs; owner uuid:=gen_random_uuid();
begin
 select q.* into j from public.upload_recovery_jobs q join public.upload_workflows w on w.event_id=q.event_id
 join public.shift_events e on e.id=w.event_id join public.sources s on s.id=e.source_id
 where q.attempts<3 and q.available_at<=now() and (q.lease_until is null or q.lease_until<now())
 and not w.cancel_requested and w.state in ('pending','incomplete','running')
 and (w.state<>'running' or w.lease_until is null or w.lease_until<now())
 and not public.upload_workflow_waiting(w.event_id) and s.origin='internal' and s.archived_at is null
 order by q.available_at,q.event_id for update of q skip locked limit 1;
 if not found then return null; end if;
 update public.upload_recovery_jobs set token=owner,lease_until=now()+interval '5 minutes',attempts=attempts+1,
 progress_count=(select count(*) from public.upload_steps where event_id=j.event_id and state='succeeded') where event_id=j.event_id;
 return jsonb_build_object('eventId',j.event_id,'token',owner);
end $$;

create function public.renew_upload_recovery(p_event_id uuid,p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.upload_recovery_jobs set lease_until=now()+interval '5 minutes' where event_id=p_event_id and token=p_token;
 return found;
end $$;

create function public.finish_upload_recovery(p_event_id uuid,p_token uuid,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare j public.upload_recovery_jobs; w public.upload_workflows; progressed boolean;
begin
 select * into j from public.upload_recovery_jobs where event_id=p_event_id and token=p_token for update;
 if not found then return; end if;
 select * into w from public.upload_workflows where event_id=p_event_id;
 if w.cancel_requested or w.state in ('complete','waiting') then delete from public.upload_recovery_jobs where event_id=p_event_id; return; end if;
 progressed:=(select count(*) from public.upload_steps where event_id=p_event_id and state='succeeded')>j.progress_count;
 update public.upload_recovery_jobs set token=null,lease_until=null,last_error=p_error,
 attempts=case when progressed then 0 else attempts end,
 available_at=now()+make_interval(secs=>least(300,15*power(2,j.attempts))::integer) where event_id=p_event_id;
end $$;

revoke all on function public.claim_upload_recovery(),public.renew_upload_recovery(uuid,uuid),public.finish_upload_recovery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_upload_recovery(),public.renew_upload_recovery(uuid,uuid),public.finish_upload_recovery(uuid,uuid,text) to service_role;

-- Optional provider budgets shared by all application/worker instances.
create table public.processing_request_slots(scope text not null,token uuid primary key,lease_until timestamptz not null);
create index processing_request_scope_idx on public.processing_request_slots(scope,lease_until);
alter table public.processing_request_slots enable row level security;
grant all on public.processing_request_slots to service_role;
create function public.claim_processing_slot(p_scope text,p_limit integer) returns uuid language plpgsql security definer set search_path='' as $$
declare owner uuid:=gen_random_uuid();
begin
 if p_limit<1 or p_limit>32 or length(p_scope)>300 then raise exception 'Invalid request budget'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_scope,0));
 delete from public.processing_request_slots where scope=p_scope and lease_until<now();
 if (select count(*) from public.processing_request_slots where scope=p_scope)>=p_limit then return null; end if;
 insert into public.processing_request_slots values(p_scope,owner,now()+interval '5 minutes');
 return owner;
end $$;
create function public.renew_processing_slot(p_scope text,p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.processing_request_slots set lease_until=now()+interval '5 minutes' where scope=p_scope and token=p_token and lease_until>now();
 return found;
end $$;
create function public.release_processing_slot(p_scope text,p_token uuid) returns void language sql security definer set search_path='' as $$
 delete from public.processing_request_slots where scope=p_scope and token=p_token
$$;
revoke all on function public.claim_processing_slot(text,integer),public.renew_processing_slot(text,uuid),public.release_processing_slot(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_processing_slot(text,integer),public.renew_processing_slot(text,uuid),public.release_processing_slot(text,uuid) to service_role;
