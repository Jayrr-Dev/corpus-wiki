-- =====================================================================
-- SECOND BRAIN · MODULE SWITCHES
-- =====================================================================
-- One switch per module (Study, Video, Docs) per space, all off by default
-- (docs/knowledge-modules-plan.md, section 0). Turning a module off hides
-- its screens; its data stays. Also registers the three roles the modules
-- use (Tutor, Narrator, Docs writer), so they can run on their own model and
-- keep instructions and memory; until someone picks one they follow the
-- active model.
-- =====================================================================

alter table public.workspace_settings
  add column modules jsonb not null default '{}'::jsonb;

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
    'modules', coalesce(s.modules, '{}'::jsonb),
    'ourEntityId', s.our_entity_id,
    'articleCharter', coalesce(s.article_charter, '{}'::jsonb)
  )
  from (select 1) anchor
  left join public.workspace_settings s
    on s.id and s.space_id = public.current_space_id();
$$;

-- WRITE: turns one module on or off for the current space; unknown names are rejected.
-- Keep the names in step with MODULE_KEYS in lib/modules.ts.
create function public.set_module_enabled(p_module text, p_enabled boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if p_module is null or p_module not in ('study', 'video', 'docs') then
    raise exception 'Unknown module "%"', p_module using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'A module is either on or off' using errcode = '22004';
  end if;
  insert into public.workspace_settings as s (id, modules, updated_at)
  values (true, jsonb_build_object(p_module, p_enabled), now())
  on conflict (space_id, id) do update
    set modules = coalesce(s.modules, '{}'::jsonb) || excluded.modules, updated_at = excluded.updated_at;
  return public.get_workspace_settings();
end;
$$;

alter function public.set_module_enabled(text, boolean) owner to space_runtime;
revoke execute on function public.set_module_enabled(text, boolean) from public, anon, authenticated;
grant execute on function public.set_module_enabled(text, boolean) to service_role, space_runtime;

-- ROLES: Tutor, Narrator and Docs writer join the role lists (instructions, memory, model, effort)
do $$
declare t text; c text; definition text; signature regprocedure;
begin
  for t,c in select * from (values ('ai_role_instructions','ai_role_instructions_role_check'),('ai_role_memory','ai_role_memory_role_check')) x(t,c) loop
    select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid=('public.'||t)::regclass and conname=c;
    execute format('alter table public.%I drop constraint %I',t,c);
    execute format('alter table public.%I add constraint %I %s',t,c,replace(definition,'''composer''','''composer'', ''tutor'', ''narrator'', ''docs_writer'''));
  end loop;
  foreach signature in array array['public.set_ai_role_model(text,text)'::regprocedure,'public.set_ai_role_effort(text,text)'::regprocedure] loop
    definition:=pg_get_functiondef(signature);
    execute replace(definition,'''composer''','''composer'',''tutor'',''narrator'',''docs_writer''');
  end loop;
end $$;

revoke create on schema public from space_runtime;

notify pgrst, 'reload schema';
