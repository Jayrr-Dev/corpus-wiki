-- Singleton settings became one row per space. Select that row explicitly even
-- when a trusted server caller can bypass RLS; ordinary callers retain RLS too.
create or replace function public.get_workspace_settings()
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'glossaryAutoDecide', coalesce(s.glossary_auto_decide, false),
    'aiModel', s.ai_model,
    'aiRoleModels', coalesce(s.ai_role_models, '{}'::jsonb),
    'aiEffort', s.ai_effort,
    'aiRoleEfforts', coalesce(s.ai_role_efforts, '{}'::jsonb),
    'aiRoleAuto', coalesce(s.ai_role_auto, '[]'::jsonb),
    'autoUpdateStale', coalesce(s.auto_update_stale, true),
    'allowExternalKnowledge', coalesce(s.allow_external_knowledge, false),
    'ourEntityId', s.our_entity_id,
    'articleCharter', coalesce(s.article_charter, '{}'::jsonb)
  )
  from (select 1) anchor
  left join public.workspace_settings s
    on s.id and s.space_id = public.current_space_id();
$$;
