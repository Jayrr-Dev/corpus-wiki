-- =====================================================================
-- SECOND BRAIN · FEATURE FLAGS
-- =====================================================================
-- One app-wide switch per unfinished feature. The keys live in code
-- (lib/flags/registry.ts); a key with no row here is off. Settings >
-- Features turns them on and off.
--
-- 1. TABLE: feature_flags (key primary key). B-tree only (OrioleDB).
-- 2. ACCESS: nobody reads or writes the table directly. Service requests
--    run as space_runtime, so both functions are SECURITY DEFINER and keep
--    the migration role as owner.
-- 3. FUNCTIONS: get_feature_flags() returns {key: enabled}; set_feature_flag
--    saves one key and returns the same object.
-- The workspace monetization switch (workspace_settings) is separate and
-- unchanged.
-- =====================================================================

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table public.feature_flags is 'App-wide feature flags; keys are registered in lib/flags/registry.ts and a missing row means off.';

alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from public, anon, authenticated;

-- READ: every saved flag as {key: enabled}
create function public.get_feature_flags()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(f.key, f.enabled), '{}'::jsonb)
  from public.feature_flags f;
$$;

-- WRITE: turns one flag on or off
create function public.set_feature_flag(p_key text, p_enabled boolean)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  insert into public.feature_flags (key, enabled, updated_at)
  values (p_key, coalesce(p_enabled, false), now())
  on conflict (key) do update
    set enabled = excluded.enabled, updated_at = excluded.updated_at;
  select public.get_feature_flags();
$$;

revoke execute on function public.get_feature_flags(), public.set_feature_flag(text, boolean)
  from public, anon, authenticated;
grant execute on function public.get_feature_flags(), public.set_feature_flag(text, boolean)
  to service_role, space_runtime;

notify pgrst, 'reload schema';
