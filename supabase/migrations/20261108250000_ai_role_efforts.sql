-- =====================================================================
-- SECOND BRAIN · REASONING EFFORT PER AI ROLE
-- =====================================================================
-- workspace_settings.ai_role_efforts
--                  { "<role id>": "low" | "medium" | "high" }: the effort
--                  that role's calls start at, instead of the workspace
--                  default (ai_effort). A role without a key uses the
--                  default. A stage that asks for its own effort keeps it.
--                  Set on /settings.
-- =====================================================================

alter table public.workspace_settings
  add column ai_role_efforts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(ai_role_efforts) = 'object');

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
    'autoUpdateStale', coalesce((select s.auto_update_stale from public.workspace_settings s where s.id), true),
    'allowExternalKnowledge', coalesce((select s.allow_external_knowledge from public.workspace_settings s where s.id), false),
    'ourEntityId', (select s.our_entity_id from public.workspace_settings s where s.id),
    'articleCharter', coalesce((select s.article_charter from public.workspace_settings s where s.id), '{}'::jsonb)
  );
$$;

-- WRITE: sets one role's effort; null (or empty) removes it, so the role uses the default effort again
create function public.set_ai_role_effort(p_role text, p_effort text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_effort text := nullif(btrim(p_effort), '');
begin
  if p_role is null or p_role not in ('media_analyst','reconciler','deduplicator','identify_entities','link_knowledge','dictionary_editor','define_concepts','plan_articles','article_reviewer','write_articles','reviewer','researcher','domain_steward') then
    raise exception 'Unknown AI role: %', p_role;
  end if;
  if v_effort is not null and v_effort not in ('low', 'medium', 'high') then
    raise exception 'Unknown reasoning effort: %', p_effort;
  end if;
  insert into public.workspace_settings (id, ai_role_efforts, updated_at)
  values (true, case when v_effort is null then '{}'::jsonb else jsonb_build_object(p_role, v_effort) end, now())
  on conflict (id) do update set
    ai_role_efforts = case when v_effort is null then public.workspace_settings.ai_role_efforts - p_role
                           else public.workspace_settings.ai_role_efforts || jsonb_build_object(p_role, v_effort) end,
    updated_at = excluded.updated_at;
  return public.get_workspace_settings();
end;
$$;

revoke execute on function public.set_ai_role_effort(text, text) from public, anon, authenticated;
grant execute on function public.set_ai_role_effort(text, text) to service_role;
