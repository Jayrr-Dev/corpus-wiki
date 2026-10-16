-- =====================================================================
-- SECOND BRAIN · MODEL PER AI ROLE
-- =====================================================================
-- workspace_settings.ai_role_models
--                  { "<role id>": "<model id>" }: a model that replaces
--                  the workspace model for every AI call of that role
--                  (lib/ai/roles.ts roleForPurpose). A role without a key
--                  uses the workspace model. Set on /settings.
-- =====================================================================

alter table public.workspace_settings
  add column ai_role_models jsonb not null default '{}'::jsonb
    check (jsonb_typeof(ai_role_models) = 'object');

create or replace function public.get_workspace_settings()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'aiModel', (select s.ai_model from public.workspace_settings s where s.id),
    'aiRoleModels', coalesce((select s.ai_role_models from public.workspace_settings s where s.id), '{}'::jsonb),
    'autoUpdateStale', coalesce((select s.auto_update_stale from public.workspace_settings s where s.id), true),
    'allowExternalKnowledge', coalesce((select s.allow_external_knowledge from public.workspace_settings s where s.id), false),
    'ourEntityId', (select s.our_entity_id from public.workspace_settings s where s.id),
    'articleCharter', coalesce((select s.article_charter from public.workspace_settings s where s.id), '{}'::jsonb)
  );
$$;

-- WRITE: sets one role's model; null (or empty) removes it, so the role uses the workspace model again
create function public.set_ai_role_model(p_role text, p_model text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_model text := nullif(btrim(p_model), '');
begin
  if p_role is null or p_role not in ('media_analyst','reconciler','deduplicator','identify_entities','link_knowledge','dictionary_editor','define_concepts','plan_articles','article_reviewer','write_articles','reviewer','researcher','domain_steward') then
    raise exception 'Unknown AI role: %', p_role;
  end if;
  insert into public.workspace_settings (id, ai_role_models, updated_at)
  values (true, case when v_model is null then '{}'::jsonb else jsonb_build_object(p_role, v_model) end, now())
  on conflict (id) do update set
    ai_role_models = case when v_model is null then public.workspace_settings.ai_role_models - p_role
                          else public.workspace_settings.ai_role_models || jsonb_build_object(p_role, v_model) end,
    updated_at = excluded.updated_at;
  return public.get_workspace_settings();
end;
$$;

revoke execute on function public.set_ai_role_model(text, text) from public, anon, authenticated;
grant execute on function public.set_ai_role_model(text, text) to service_role;
