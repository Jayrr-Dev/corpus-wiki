-- A FAILED MODULE STOPS BLOCKING THE NEXT ONES: entities, the glossary and the Curator waited for
-- the Wiki to be done, so a Wiki out of attempts left them waiting for good. They now run on what
-- is saved once it has finished either way; Retry on the Wiki still runs it again.
create or replace function public.claim_module_upkeep(p_module text) returns jsonb
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
      where before.event_id = m.event_id and before.module = any(public.module_upkeep_after(m.module)) and before.state not in ('done', 'failed'))
    and not public.upload_workflow_waiting(m.event_id)
  order by m.created_at, m.id
  for update of m skip locked limit 1;
  if not found then return null; end if;
  update public.module_upkeep set state = 'running', token = owner, lease_until = now() + interval '10 minutes',
    attempts = attempts + 1, updated_at = now() where id = item.id;
  return jsonb_build_object('id', item.id, 'eventId', item.event_id, 'module', item.module, 'token', owner, 'attempts', item.attempts + 1);
end $$;
