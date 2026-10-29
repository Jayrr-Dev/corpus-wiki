-- =====================================================================
-- SECOND BRAIN · KNOWLEDGE MODULE ROLES
-- =====================================================================
-- Registers the three roles the Study, Video and Docs modules use (Tutor,
-- Narrator, Docs writer), so they can run on their own model and keep
-- instructions and memory; until someone picks one they follow the active
-- model. The modules themselves are switched by app-wide feature flags
-- (lib/flags/registry.ts: study, video, docs); see
-- docs/knowledge-modules-plan.md.
-- =====================================================================

grant create on schema public to space_runtime;

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
