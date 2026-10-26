-- =====================================================================
-- SECOND BRAIN · MONETIZATION SWITCH
-- =====================================================================
-- One switch per space for usage-based plans (docs/monetization-plan.md).
-- Off by default. While it is off nothing is limited or charged; the plan's
-- later steps read this flag before they enforce anything.
-- =====================================================================

alter table public.workspace_settings
  add column monetization_enabled boolean not null default false;

grant create on schema public to space_runtime;

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
    'monetizationEnabled', coalesce(s.monetization_enabled, false),
    'ourEntityId', s.our_entity_id,
    'articleCharter', coalesce(s.article_charter, '{}'::jsonb)
  )
  from (select 1) anchor
  left join public.workspace_settings s
    on s.id and s.space_id = public.current_space_id();
$$;

-- WRITE: turns usage-based plans on or off for the current space
create function public.set_monetization_enabled(p_enabled boolean)
returns jsonb
language sql
set search_path = ''
as $$
  insert into public.workspace_settings (id, monetization_enabled, updated_at)
  values (true, p_enabled, now())
  on conflict (space_id, id) do update
    set monetization_enabled = excluded.monetization_enabled, updated_at = excluded.updated_at;
  select public.get_workspace_settings();
$$;

alter function public.set_monetization_enabled(boolean) owner to space_runtime;
revoke execute on function public.set_monetization_enabled(boolean) from public, anon, authenticated;
grant execute on function public.set_monetization_enabled(boolean) to service_role, space_runtime;

revoke create on schema public from space_runtime;
