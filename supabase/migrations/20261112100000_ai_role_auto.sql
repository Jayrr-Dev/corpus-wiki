-- =====================================================================
-- SECOND BRAIN · FULL AUTO PER AI ROLE
-- =====================================================================
-- workspace_settings.ai_role_auto
--                  [ "<role id>", … ]: roles in full auto. What such a
--                  role would hold in Exceptions is accepted at once,
--                  with a note, so it never waits for a person. Set on
--                  the Roles tab of /skills. Undo stays in Changes.
--                  A new root topic still waits (it has no role).
-- =====================================================================

alter table public.workspace_settings
  add column ai_role_auto jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ai_role_auto) = 'array');

create or replace function public.get_workspace_settings()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'aiModel', (select s.ai_model from public.workspace_settings s where s.id),
    'aiRoleModels', coalesce((select s.ai_role_models from public.workspace_settings s where s.id), '{}'::jsonb),
    'aiEffort', (select s.ai_effort from public.workspace_settings s where s.id),
    'aiRoleEfforts', coalesce((select s.ai_role_efforts from public.workspace_settings s where s.id), '{}'::jsonb),
    'aiRoleAuto', coalesce((select s.ai_role_auto from public.workspace_settings s where s.id), '[]'::jsonb),
    'autoUpdateStale', coalesce((select s.auto_update_stale from public.workspace_settings s where s.id), true),
    'allowExternalKnowledge', coalesce((select s.allow_external_knowledge from public.workspace_settings s where s.id), false),
    'ourEntityId', (select s.our_entity_id from public.workspace_settings s where s.id),
    'articleCharter', coalesce((select s.article_charter from public.workspace_settings s where s.id), '{}'::jsonb)
  );
$$;

-- WRITE: turns full auto on or off for one role that can raise Exceptions
create function public.set_ai_role_auto(p_role text, p_on boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if p_role is null or p_role not in ('reconciler','deduplicator','write_articles','reviewer','domain_steward','curator') then
    raise exception 'This AI role raises no Exceptions: %', p_role;
  end if;
  insert into public.workspace_settings (id, ai_role_auto, updated_at)
  values (true, case when p_on then jsonb_build_array(p_role) else '[]'::jsonb end, now())
  on conflict (id) do update set
    ai_role_auto = case when p_on then (public.workspace_settings.ai_role_auto - p_role) || jsonb_build_array(p_role)
                        else public.workspace_settings.ai_role_auto - p_role end,
    updated_at = excluded.updated_at;
  return public.get_workspace_settings();
end;
$$;

-- ACCEPT WHAT A ROLE IN FULL AUTO HELD: the open Exceptions of one ChangeSet, or (no ChangeSet, for the
-- Reviewer, whose page review returns none) every open one on that role's ChangeSets. Does nothing when
-- the role is not in full auto. Root topic approvals are left for a person. One that can no longer apply
-- (its knowledge changed since) stays open. Returns what was accepted, for the caller's page upkeep.
create function public.auto_accept_exceptions(p_role text, p_change_set_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_exception record;
  v_result jsonb;
  v_accepted jsonb := '[]'::jsonb;
begin
  if not coalesce((select s.ai_role_auto ? p_role from public.workspace_settings s where s.id), false) then
    return v_accepted;
  end if;
  for v_exception in
    select e.id, e.reason, e.action_id from public.exceptions e
    join public.actions a on a.id = e.action_id
    join public.change_sets cs on cs.id = a.change_set_id
    where e.status = 'open' and e.reason::text <> 'root_domain_approval'
      and (a.change_set_id = p_change_set_id
           or (p_change_set_id is null and cs.actor_attribution -> 'proposedBy' ->> 'role' = p_role))
    order by e.created_at
  loop
    begin
      v_result := public.resolve_exception(v_exception.id, true, 'Accepted automatically: this role is in full auto.');
      v_accepted := v_accepted || jsonb_build_array(jsonb_build_object(
        'exceptionId', v_exception.id, 'reason', v_exception.reason, 'actionId', v_exception.action_id, 'eventId', v_result ->> 'eventId'));
    exception when others then
      raise warning 'Full auto left exception % open: %', v_exception.id, sqlerrm;
    end;
  end loop;
  return v_accepted;
end;
$$;

revoke execute on function public.set_ai_role_auto(text, boolean), public.auto_accept_exceptions(text, uuid) from public, anon, authenticated;
grant execute on function public.set_ai_role_auto(text, boolean), public.auto_accept_exceptions(text, uuid) to service_role;
