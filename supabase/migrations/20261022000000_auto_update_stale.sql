-- =====================================================================
-- SECOND BRAIN · AUTO-UPDATE STALE LINES
-- =====================================================================
-- A line is stale when it cites a claim revision that is no longer
-- current. When this setting is on (the default), opening an article
-- rewrites those lines. Turn it off to leave them until Update is clicked.
-- =====================================================================

alter table public.workspace_settings
  add column auto_update_stale boolean not null default true;

create or replace function public.get_workspace_settings()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'aiModel', (select s.ai_model from public.workspace_settings s where s.id),
    'autoUpdateStale', coalesce((select s.auto_update_stale from public.workspace_settings s where s.id), true)
  );
$$;

create function public.set_auto_update_stale(p_enabled boolean)
returns jsonb
language sql
set search_path = ''
as $$
  insert into public.workspace_settings (id, auto_update_stale, updated_at)
  values (true, p_enabled, now())
  on conflict (id) do update
    set auto_update_stale = excluded.auto_update_stale, updated_at = excluded.updated_at;
  select public.get_workspace_settings();
$$;

revoke execute on function public.set_auto_update_stale(boolean) from public, anon, authenticated;
grant execute on function public.set_auto_update_stale(boolean) to service_role;
