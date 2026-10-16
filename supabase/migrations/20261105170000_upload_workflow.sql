-- Processing completion is separate from the knowledge event's commit status.
create table public.upload_workflows (
  event_id uuid primary key references public.shift_events(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','running','waiting','complete','incomplete')),
  token uuid,
  lease_until timestamptz,
  resume_requested boolean not null default false,
  error text,
  change_set_id uuid references public.change_sets(id),
  updated_at timestamptz not null default now()
);
create table public.upload_steps (
  event_id uuid not null references public.upload_workflows(event_id) on delete cascade,
  key text not null,
  state text not null check (state in ('running','succeeded','failed')),
  attempts integer not null default 1,
  output jsonb,
  error text,
  updated_at timestamptz not null default now(),
  primary key(event_id,key)
);
create table public.upload_writes (
  event_id uuid not null references public.upload_workflows(event_id) on delete cascade,
  key text not null,
  function_name text not null,
  result jsonb,
  primary key(event_id,key)
);
alter table public.upload_workflows enable row level security;
alter table public.upload_steps enable row level security;
alter table public.upload_writes enable row level security;
grant all on public.upload_workflows,public.upload_steps,public.upload_writes to service_role;

create function change_control.initialize_upload_workflow() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.cause='upload' then
   insert into public.upload_workflows(event_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger shift_events_initialize_workflow after insert on public.shift_events
for each row execute function change_control.initialize_upload_workflow();

create function public.upload_workflow_waiting(p_event_id uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.exceptions x join public.actions a on a.id=x.action_id
 join public.change_sets c on c.id=a.change_set_id where c.event_id=p_event_id
 and x.reason::text='root_domain_approval' and x.status='open')
$$;

-- Every durable write locks and checks ownership in the same transaction as the write.
create function public.assert_upload_lease(p_event_id uuid,p_token uuid) returns void
language plpgsql set search_path='' as $$
declare w public.upload_workflows;
begin
 select * into w from public.upload_workflows where event_id=p_event_id for update;
 if w.token is distinct from p_token or w.token is null or w.state<>'running' or w.lease_until<=now() then
   raise exception 'Upload ownership expired. Resume the upload to continue.';
 end if;
 if not exists(select 1 from public.shift_events e join public.sources s on s.id=e.source_id
   where e.id=p_event_id and s.archived_at is null) then
   raise exception 'The source is archived or deleted. Restore it before resuming.';
 end if;
 update public.upload_workflows set lease_until=now()+interval '5 minutes',updated_at=now() where event_id=p_event_id;
end $$;

create function public.claim_upload_workflow(p_event_id uuid) returns jsonb
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
 if w.change_set_id is null and prior is not null then
   update public.upload_workflows set change_set_id=prior where event_id=p_event_id;
   w.change_set_id:=prior;
 end if;
 if exists(select 1 from public.change_sets where id=w.change_set_id and status='reverted') then
   raise exception 'The original knowledge changes were undone. Start an explicit source re-run instead.';
 end if;
 t:=gen_random_uuid();
 update public.upload_workflows set state='running',token=t,error=null,resume_requested=false,lease_until=now()+interval '5 minutes',updated_at=now() where event_id=p_event_id;
 return jsonb_build_object('claimed',true,'token',t,'changeSetId',w.change_set_id);
end $$;

create function public.start_upload_step(p_event_id uuid,p_token uuid,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.upload_steps;
begin
 perform public.assert_upload_lease(p_event_id,p_token);
 select * into s from public.upload_steps where event_id=p_event_id and key=p_key;
 if s.state='succeeded' then return jsonb_build_object('done',true,'output',s.output); end if;
 insert into public.upload_steps(event_id,key,state) values(p_event_id,p_key,'running')
 on conflict(event_id,key) do update set state='running',attempts=upload_steps.attempts+1,error=null,updated_at=now();
 return jsonb_build_object('done',false);
end $$;

create function public.finish_upload_step(p_event_id uuid,p_token uuid,p_key text,p_output jsonb,p_error text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_upload_lease(p_event_id,p_token);
 update public.upload_steps set state=case when p_error is null then 'succeeded' else 'failed' end,
 output=p_output,error=p_error,updated_at=now() where event_id=p_event_id and key=p_key;
end $$;

-- Narrow dispatch: these existing functions continue to enforce all change-control policies.
-- Arguments are converted using their actual PostgreSQL types, not interpolated values.
create function public.upload_workflow_write(p_event_id uuid,p_token uuid,p_key text,p_function text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.upload_writes; proc record; declarations text; arguments text; answer jsonb; cs public.change_sets; origin public.shift_events;
begin
 perform public.assert_upload_lease(p_event_id,p_token);
 if p_function not in ('submit_change_set','commit_change_set','complete_page_review') then raise exception 'Unsupported workflow write'; end if;
 select * into saved from public.upload_writes where event_id=p_event_id and key=p_key;
 if found then
   if saved.function_name<>p_function then raise exception 'Workflow operation key reused'; end if;
   return saved.result;
 end if;
 if p_function='submit_change_set' and p_key='reconcile:submit' then
   select c.* into cs from public.change_sets c join public.upload_workflows w on w.change_set_id=c.id where w.event_id=p_event_id;
   if found then answer:=jsonb_build_object('changeSetId',cs.id,'eventId',cs.event_id); end if;
 end if;
 if p_function='commit_change_set' then
   if not exists(select 1 from public.upload_workflows where event_id=p_event_id and change_set_id=(p_args->>'p_change_set_id')::uuid)
     and not exists(select 1 from public.upload_writes where event_id=p_event_id and function_name='submit_change_set'
       and result->>'changeSetId'=p_args->>'p_change_set_id') then raise exception 'Change set does not belong to this workflow'; end if;
   select * into cs from public.change_sets where id=(p_args->>'p_change_set_id')::uuid for update;
   if cs.status<>'draft' then answer:=change_control.commit_summary(cs.id,cs.status); end if;
 end if;
 if answer is null then
   select * into origin from public.shift_events where id=p_event_id;
   -- Preserve the original initiating person on AI continuations, even when a
   -- different person resumes the work. Approval answers retain their own actor.
   perform set_config('request.headers', (coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb
     || jsonb_build_object('x-person-id',origin.person_id,'x-via',origin.via))::text,true);
   select p.* into strict proc from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=p_function and p.prokind='f';
   select string_agg(format('%I %s',proc.proargnames[i],pg_catalog.format_type(proc.proargtypes[i-1],null)),',' order by i),
     string_agg(format('%I => a.%I',proc.proargnames[i],proc.proargnames[i]),',' order by i)
     into declarations,arguments from generate_series(1,proc.pronargs) i where p_args ? proc.proargnames[i];
   execute format('select to_jsonb(public.%I(%s)) from jsonb_to_record($1) as a(%s)',p_function,arguments,declarations) into answer using p_args;
 end if;
 insert into public.upload_writes(event_id,key,function_name,result) values(p_event_id,p_key,p_function,answer);
 if p_key='reconcile:submit' then update public.upload_workflows set change_set_id=(answer->>'changeSetId')::uuid where event_id=p_event_id; end if;
 return answer;
end $$;

create function public.release_upload_workflow(p_event_id uuid,p_token uuid,p_state text,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare w public.upload_workflows; resume boolean:=false;
begin
 if p_state not in ('waiting','complete','incomplete') then raise exception 'Invalid workflow state'; end if;
 select * into w from public.upload_workflows where event_id=p_event_id for update;
 if w.token is distinct from p_token then return false; end if;
 -- An approval callback may arrive while the original request is about to pause.
 -- Hand continuation back to that owner rather than dropping the callback.
 resume:=p_state='waiting' and w.resume_requested and not public.upload_workflow_waiting(p_event_id);
 -- Release still works after source archival, but an old owner cannot release a new owner's lease.
 update public.upload_workflows set state=case when resume then 'pending' else p_state end,error=p_error,token=null,lease_until=null,updated_at=now()
 where event_id=p_event_id and token=p_token;
 return resume;
end $$;

create function public.read_upload_workflows(p_event_ids uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(w)-'token' || jsonb_build_object('waiting',public.upload_workflow_waiting(w.event_id),
 'steps',coalesce((select jsonb_agg(jsonb_build_object('key',s.key,'state',s.state,'error',s.error,'attempts',s.attempts) order by s.updated_at,s.key)
 from public.upload_steps s where s.event_id=w.event_id),'[]'::jsonb))),'[]'::jsonb)
 from public.upload_workflows w where w.event_id=any(p_event_ids)
$$;

-- Safe summaries are readable like the app's other shared-workspace data.
-- Raw outputs and ownership tokens stay service-only.
create function public.upload_knowledge_result(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select change_control.commit_summary(c.id,c.status) from public.upload_workflows w
 join public.change_sets c on c.id=w.change_set_id where w.event_id=p_event_id and c.status<>'draft'
$$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('upload_workflow_waiting','assert_upload_lease','claim_upload_workflow','start_upload_step',
 'finish_upload_step','upload_workflow_write','release_upload_workflow','read_upload_workflows','upload_knowledge_result') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
grant execute on function public.read_upload_workflows(uuid[]) to authenticated;
