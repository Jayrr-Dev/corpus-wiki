-- Upload jobs, step 2 of docs/upload-jobs-plan.md: enqueue, claim and finish, with readiness
-- and cancel. A job runs inside the upload's own lease (upload_workflows.token), so the lease
-- checks, checkpoints and idempotent writes it already uses keep fencing it. B-tree only (OrioleDB).

-- The table predates this and is still empty: it gets the same space boundary as every other table.
alter table public.upload_jobs add column space_id uuid not null default public.current_space_id() references public.spaces(id) on delete cascade;
create index upload_jobs_space_idx on public.upload_jobs(space_id);
alter table public.upload_jobs force row level security;
create policy space_boundary on public.upload_jobs as restrictive for all to space_runtime using (space_id = (select public.current_space_id())) with check (space_id = (select public.current_space_id()));
create policy space_server on public.upload_jobs for all to space_runtime using (true) with check (true);
revoke all on public.upload_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.upload_jobs to space_runtime, service_role;

-- Blocked jobs whose dependencies have all succeeded become ready, unless the upload is
-- cancelled or waits for an approval. Readiness is per upload, which is small.
create function public.refresh_upload_jobs(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if public.upload_workflow_waiting(p_event_id)
   or exists(select 1 from public.upload_workflows where event_id=p_event_id and cancel_requested) then return; end if;
 update public.upload_jobs j set state='ready',updated_at=now()
 where j.event_id=p_event_id and j.state='blocked'
 and not exists(select 1 from unnest(j.depends_on) d(key) where not exists(
   select 1 from public.upload_jobs x where x.event_id=p_event_id and x.key=d.key and x.state='succeeded'));
end $$;

-- p_jobs: [{kind,key,input?,dependsOn?,provider?}]. The same key twice is a no-op.
create function public.enqueue_upload_jobs(p_event_id uuid,p_token uuid,p_jobs jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_upload_lease(p_event_id,p_token);
 insert into public.upload_jobs(event_id,kind,key,input,depends_on,provider)
 select p_event_id,j->>'kind',j->>'key',coalesce(j->'input','{}'::jsonb),
   coalesce(array(select jsonb_array_elements_text(j->'dependsOn')),'{}'),j->>'provider'
 from jsonb_array_elements(coalesce(p_jobs,'[]'::jsonb)) j
 on conflict (event_id,key) do nothing;
 perform public.refresh_upload_jobs(p_event_id);
end $$;

-- A person's Resume runs failed and cancelled jobs again; succeeded jobs are never touched.
create function public.reset_upload_jobs(p_event_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_upload_lease(p_event_id,p_token);
 update public.upload_jobs set state='blocked',attempts=0,last_error=null,token=null,lease_until=null,updated_at=now()
 where event_id=p_event_id and state in ('failed','cancelled');
 perform public.refresh_upload_jobs(p_event_id);
end $$;

-- The next ready job of this upload among p_kinds, or null. A job left running by a dead owner
-- is ready again: the upload lease was lost, and its writes replay from their operation keys.
create function public.claim_upload_job(p_event_id uuid,p_token uuid,p_kinds text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.upload_jobs;
begin
 perform public.assert_upload_lease(p_event_id,p_token);
 update public.upload_jobs set state='ready',token=null,lease_until=null,updated_at=now()
 where event_id=p_event_id and state='running' and token is distinct from p_token;
 -- A job that keeps losing its owner stops being handed out
 update public.upload_jobs set state='failed',last_error='This step stopped too many times. Resume the upload to try again.',updated_at=now()
 where event_id=p_event_id and state='ready' and attempts>=max_attempts;
 perform public.refresh_upload_jobs(p_event_id);
 select * into j from public.upload_jobs
 where event_id=p_event_id and state='ready' and kind=any(p_kinds) and available_at<=now() and attempts<max_attempts
 order by created_at,key for update limit 1;
 if not found then return null; end if;
 update public.upload_jobs set state='running',token=p_token,lease_until=now()+interval '5 minutes',
 attempts=attempts+1,updated_at=now() where id=j.id;
 return jsonb_build_object('id',j.id,'event_id',j.event_id,'kind',j.kind,'key',j.key,'input',j.input,
   'depends_on',to_jsonb(j.depends_on),'state','running','provider',j.provider,'attempts',j.attempts+1);
end $$;

-- Saves the result, adds the jobs it fans out and readies what now can run, in one transaction.
-- p_again: the job raised an approval and runs once more after it, to read the answer.
-- False when the job is no longer this owner's (the lease moved on).
create function public.finish_upload_job(p_job_id uuid,p_token uuid,p_output jsonb,p_enqueue jsonb,p_again boolean,p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.upload_jobs;
begin
 select * into j from public.upload_jobs where id=p_job_id and token=p_token and state='running' for update;
 if not found then return false; end if;
 update public.upload_jobs set state=case when p_error is not null then 'failed' when p_again then 'blocked' else 'succeeded' end,
 attempts=case when p_again and p_error is null then 0 else attempts end,
 output=p_output,
 last_error=p_error,token=null,lease_until=null,updated_at=now() where id=p_job_id;
 if p_error is null then
   insert into public.upload_jobs(space_id,event_id,kind,key,input,depends_on,provider)
   select j.space_id,j.event_id,e->>'kind',e->>'key',coalesce(e->'input','{}'::jsonb),
     coalesce(array(select jsonb_array_elements_text(e->'dependsOn')),'{}'),e->>'provider'
   from jsonb_array_elements(coalesce(p_enqueue,'[]'::jsonb)) e
   on conflict (event_id,key) do nothing;
 end if;
 perform public.refresh_upload_jobs(j.event_id);
 return true;
end $$;

-- How many of this upload's jobs are in each state, e.g. {"succeeded":8,"blocked":7}
create function public.upload_job_counts(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(state,n),'{}'::jsonb) from (
   select state,count(*) n from public.upload_jobs where event_id=p_event_id group by state) c
$$;

-- A cancel stops every job that has not started; the running one sees it at its next lease check.
create function change_control.cancel_upload_jobs() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.upload_jobs set state='cancelled',updated_at=now() where event_id=new.event_id and state in ('blocked','ready');
 return new;
end $$;
create trigger cancel_upload_jobs after update of cancel_requested on public.upload_workflows
 for each row when (new.cancel_requested and not old.cancel_requested) execute function change_control.cancel_upload_jobs();

-- Run as space_runtime, like the lease functions they call, so the space boundary applies
grant create on schema public, change_control to space_runtime;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname in ('refresh_upload_jobs','enqueue_upload_jobs','reset_upload_jobs','claim_upload_job','finish_upload_job','upload_job_counts'))
 or (n.nspname='change_control' and p.proname='cancel_upload_jobs') loop
 execute format('alter function %s owner to space_runtime',f.signature);
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role,space_runtime',f.signature);
 end loop;
end $$;
revoke create on schema public, change_control from space_runtime;
notify pgrst,'reload schema';
