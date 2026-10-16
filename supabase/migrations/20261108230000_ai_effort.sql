-- =====================================================================
-- SECOND BRAIN · DEFAULT REASONING EFFORT
-- =====================================================================
-- workspace_settings.ai_effort
--                  'low' | 'medium' | 'high': the reasoning effort AI calls
--                  start at (lib/ai/chat.ts). Null means the built-in
--                  default (medium). A stage that asks for its own effort
--                  keeps it. Set on /settings.
-- =====================================================================

alter table public.workspace_settings
  add column ai_effort text check (ai_effort in ('low', 'medium', 'high'));

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
    'autoUpdateStale', coalesce((select s.auto_update_stale from public.workspace_settings s where s.id), true),
    'allowExternalKnowledge', coalesce((select s.allow_external_knowledge from public.workspace_settings s where s.id), false),
    'ourEntityId', (select s.our_entity_id from public.workspace_settings s where s.id),
    'articleCharter', coalesce((select s.article_charter from public.workspace_settings s where s.id), '{}'::jsonb)
  );
$$;

-- WRITE: sets the default effort; null (or empty) goes back to the built-in default
create function public.set_ai_effort(p_effort text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_effort text := nullif(btrim(p_effort), '');
begin
  if v_effort is not null and v_effort not in ('low', 'medium', 'high') then
    raise exception 'Unknown reasoning effort: %', p_effort;
  end if;
  insert into public.workspace_settings (id, ai_effort, updated_at)
  values (true, v_effort, now())
  on conflict (id) do update set ai_effort = excluded.ai_effort, updated_at = excluded.updated_at;
  return public.get_workspace_settings();
end;
$$;

revoke execute on function public.set_ai_effort(text) from public, anon, authenticated;
grant execute on function public.set_ai_effort(text) to service_role;
