-- MODULE UPKEEP: an upload saves knowledge only; each module then brings itself up to date
-- from it, on the background worker (lib/processing/moduleUpkeep.ts). One row per finished
-- upload and module. A module waits for the modules before it on the same upload:
--   definitions -> wiki -> entities, glossary, curator
-- A running item holds a lease on its upload (its token), so the upload's checkpoints,
-- idempotent writes, Reviewer budget approval and Cancel work for module work too.
-- B-tree only (OrioleDB rules in AGENTS.md still apply to older projects).
create table public.module_upkeep (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null default public.current_space_id() references public.spaces(id) on delete cascade,
  event_id uuid not null references public.shift_events(id) on delete cascade,
  module text not null check (module in ('definitions', 'wiki', 'entities', 'glossary', 'curator')),
  state text not null default 'ready' check (state in ('ready', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, module)
);
create index module_upkeep_claim_idx on public.module_upkeep(space_id, module, state, available_at);
create index module_upkeep_event_idx on public.module_upkeep(event_id);
create index module_upkeep_token_idx on public.module_upkeep(token);
alter table public.module_upkeep enable row level security;
alter table public.module_upkeep force row level security;
create policy space_boundary on public.module_upkeep as restrictive for all to space_runtime using (space_id = (select public.current_space_id())) with check (space_id = (select public.current_space_id()));
create policy space_server on public.module_upkeep for all to space_runtime using (true) with check (true);
revoke all on public.module_upkeep from public, anon, authenticated;
grant select, insert, update, delete on public.module_upkeep to space_runtime, service_role;

-- The modules a module waits for on the same upload
create function public.module_upkeep_after(p_module text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_module
    when 'wiki' then array['definitions']
    when 'entities' then array['definitions', 'wiki']
    when 'glossary' then array['definitions', 'wiki']
    when 'curator' then array['definitions', 'wiki']
    else array[]::text[] end
$$;

-- A finished upload hands its knowledge to every module. The same upload twice is a no-op,
-- except that a finished, failed or cancelled item runs again.
create function public.enqueue_module_upkeep(p_event_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.module_upkeep(event_id, module)
  select p_event_id, module from unnest(array['definitions', 'wiki', 'entities', 'glossary', 'curator']) module
  on conflict (event_id, module) do update set state = 'ready', attempts = 0, last_error = null, available_at = now(), updated_at = now()
    where public.module_upkeep.state in ('done', 'failed', 'cancelled');
$$;

-- The oldest ready item of a module whose earlier modules on the same upload are done, or null.
-- An item whose worker died (lease expired) is ready again; an upload waiting for a person's
-- answer (a new root, the Reviewer budget) holds its items until it is answered.
create function public.claim_module_upkeep(p_module text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.module_upkeep; owner uuid := gen_random_uuid();
begin
  update public.module_upkeep set state = 'ready', token = null, lease_until = null, updated_at = now()
  where space_id = public.current_space_id() and module = p_module and state = 'running' and lease_until < now();
  update public.module_upkeep set state = 'failed', last_error = coalesce(last_error, 'Stopped after too many attempts.'), updated_at = now()
  where space_id = public.current_space_id() and module = p_module and state = 'ready' and attempts >= max_attempts;
  select m.* into item from public.module_upkeep m
  where m.space_id = public.current_space_id() and m.module = p_module and m.state = 'ready' and m.available_at <= now()
    and not exists (select 1 from public.module_upkeep before
      where before.event_id = m.event_id and before.module = any(public.module_upkeep_after(m.module)) and before.state <> 'done')
    and not public.upload_workflow_waiting(m.event_id)
  order by m.created_at, m.id
  for update of m skip locked limit 1;
  if not found then return null; end if;
  update public.module_upkeep set state = 'running', token = owner, lease_until = now() + interval '10 minutes',
    attempts = attempts + 1, updated_at = now() where id = item.id;
  return jsonb_build_object('id', item.id, 'eventId', item.event_id, 'module', item.module, 'token', owner, 'attempts', item.attempts + 1);
end $$;

-- False once the item is no longer this worker's (cancelled, or its lease moved on)
create function public.renew_module_upkeep(p_id uuid, p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.module_upkeep set lease_until = now() + interval '10 minutes', updated_at = now()
  where id = p_id and token = p_token and state = 'running';
  return found;
end $$;

-- Done; or waiting for a person's answer (ready again, not counted as an attempt); or failed,
-- with a retry after a pause and failed for good after max_attempts. A cancelled item stays so.
create function public.finish_module_upkeep(p_id uuid, p_token uuid, p_error text default null, p_waiting boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare item public.module_upkeep;
begin
  update public.module_upkeep set
    state = case when p_waiting or (p_error is not null and attempts < max_attempts) then 'ready' when p_error is null then 'done' else 'failed' end,
    attempts = case when p_waiting then greatest(attempts - 1, 0) else attempts end,
    last_error = case when p_waiting then null else p_error end, token = null, lease_until = null,
    available_at = case when p_error is not null and not p_waiting then now() + interval '2 minutes' * attempts else now() end,
    updated_at = now()
  where id = p_id and token = p_token and state = 'running'
  returning * into item;
  if found then update public.upload_workflows set progress = null where event_id = item.event_id and state <> 'running'; end if;
end $$;

-- A person's Retry on a module's failed or cancelled items
create function public.retry_module_upkeep(p_module text) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.module_upkeep set state = 'ready', attempts = 0, last_error = null, available_at = now(), updated_at = now()
  where space_id = public.current_space_id() and module = p_module and state in ('failed', 'cancelled');
  get diagnostics n = row_count;
  return n;
end $$;

-- Each module's queue: waiting, working, failed, cancelled, and the latest error
create function public.module_upkeep_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(module, status), '{}'::jsonb) from (
    select module, jsonb_build_object(
      'waiting', count(*) filter (where state = 'ready'),
      'working', count(*) filter (where state = 'running'),
      'failed', count(*) filter (where state = 'failed'),
      'cancelled', count(*) filter (where state = 'cancelled'),
      'error', (array_agg(last_error order by updated_at desc) filter (where state = 'failed'))[1]) status
    from public.module_upkeep where space_id = public.current_space_id() and state <> 'done'
    group by module) q
$$;

-- Each upload's module work, for its row on the Upload screen (read by the browser, so only
-- uploads in a space the reader can see)
create function public.upload_module_upkeep(p_event_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(event_id, modules), '{}'::jsonb) from (
    select event_id, jsonb_agg(jsonb_build_object('module', module, 'state', state, 'error', last_error)
      order by array_position(array['definitions', 'wiki', 'entities', 'glossary', 'curator'], module)) modules
    from public.module_upkeep where event_id = any(p_event_ids) and space_id = any(public.readable_space_ids())
    group by event_id) q
$$;

-- A person's Retry for one upload's failed or cancelled module work
create function public.retry_upload_module_upkeep(p_event_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.module_upkeep set state = 'ready', attempts = 0, last_error = null, available_at = now(), updated_at = now()
  where event_id = p_event_id and space_id = public.current_space_id() and state in ('failed', 'cancelled');
  get diagnostics n = row_count;
  return n;
end $$;

-- THE UPLOAD LEASE, ALSO FOR MODULE WORK: a running module item's token counts as a lease on
-- its upload. Cancel and archiving stop it the same way.
create or replace function public.assert_upload_lease(p_event_id uuid, p_token uuid) returns void
language plpgsql set search_path = '' as $$
declare w public.upload_workflows; m public.module_upkeep;
begin
 select * into m from public.module_upkeep where event_id = p_event_id and token = p_token for update;
 if found then
   if m.state = 'cancelled' then raise exception 'Processing was cancelled.'; end if;
   if m.state <> 'running' or m.lease_until <= now() then raise exception 'Module upkeep ownership expired. It runs again on its own.'; end if;
   if not exists(select 1 from public.shift_events e join public.sources s on s.id = e.source_id
     where e.id = p_event_id and s.archived_at is null) then
     raise exception 'The source is archived or deleted. Restore it before resuming.';
   end if;
   update public.module_upkeep set lease_until = now() + interval '10 minutes', updated_at = now() where id = m.id;
   return;
 end if;
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

create or replace function public.heartbeat_upload_workflow(p_event_id uuid, p_token uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.upload_workflows;
begin
  if exists(select 1 from public.module_upkeep where event_id = p_event_id and token = p_token) then
    perform public.assert_upload_lease(p_event_id, p_token);
    return;
  end if;
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

create or replace function public.hold_upload_for_reviewer_budget(p_event_id uuid, p_token uuid, p_sections integer, p_estimate integer, p_budget integer) returns text
language plpgsql security definer set search_path = '' as $$
declare held public.exceptions; submitted jsonb; cs uuid; a uuid;
begin
 if not exists(select 1 from public.upload_workflows where event_id=p_event_id and token=p_token)
   and not exists(select 1 from public.module_upkeep where event_id=p_event_id and token=p_token and state='running') then
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
   '. Accept to write its pages. Decline to stop before any pages are written; its knowledge stays saved.'));
 perform change_control.refresh_status(cs);
 return 'waiting';
end $$;

-- CANCEL ALSO STOPS MODULE WORK: an upload whose knowledge is saved can still cancel its
-- articles and other module updates; a running item stops at its next lease check.
create or replace function public.cancel_upload_workflow(p_event_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare w public.upload_workflows; running boolean; stopped integer;
begin
 select exists(select 1 from public.module_upkeep where event_id = p_event_id and state = 'running' and lease_until > now()) into running;
 update public.module_upkeep set state = 'cancelled', last_error = 'Cancelled', available_at = now(), updated_at = now()
 where event_id = p_event_id and state in ('ready', 'running');
 get diagnostics stopped = row_count;
 select * into w from public.upload_workflows where event_id=p_event_id for update;
 if not found or w.state in ('complete','waiting') then
   return case when running then 'cancelling' when stopped > 0 then 'cancelled' else 'idle' end;
 end if;
 update public.upload_workflows set cancel_requested=true,resume_requested=false,updated_at=now() where event_id=p_event_id;
 if w.state='running' and w.lease_until>now() then return 'cancelling'; end if;
 update public.upload_workflows set state='incomplete',error='Processing was cancelled.',token=null,lease_until=null,progress=null
 where event_id=p_event_id;
 update public.upload_steps set state='failed',error='Cancelled',updated_at=now() where event_id=p_event_id and state='running';
 return 'cancelled';
end $$;

grant create on schema public to space_runtime;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('module_upkeep_after', 'enqueue_module_upkeep', 'claim_module_upkeep', 'renew_module_upkeep',
    'finish_module_upkeep', 'retry_module_upkeep', 'module_upkeep_status', 'upload_module_upkeep', 'retry_upload_module_upkeep',
    'assert_upload_lease', 'heartbeat_upload_workflow', 'hold_upload_for_reviewer_budget', 'cancel_upload_workflow') loop
    execute format('alter function %s owner to space_runtime', f.signature);
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role, space_runtime', f.signature);
  end loop;
end $$;
grant execute on function public.upload_module_upkeep(uuid[]) to authenticated;
revoke create on schema public from space_runtime;
notify pgrst, 'reload schema';
