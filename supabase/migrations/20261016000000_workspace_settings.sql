-- =====================================================================
-- SECOND BRAIN · WORKSPACE SETTINGS
-- =====================================================================
-- One row of settings the whole workspace shares. For now: the AI model
-- that drafts ChangeSets and writes wiki lines, picked on /settings from
-- Token Factory's live model list. A null model means "not chosen": the
-- server falls back to AI_MODEL, then to the Nemotron default
-- (lib/ai/chat.ts resolveModel). Server code reads and writes it through
-- the two functions below (service_role only).
-- =====================================================================

-- SETTINGS ROW: `id` is always true, so the table can only ever hold one row
create table public.workspace_settings (
  id boolean primary key default true check (id),
  ai_model text check (ai_model is null or length(btrim(ai_model)) > 0),
  updated_at timestamptz not null default now()
);

alter table public.workspace_settings enable row level security;
revoke all on public.workspace_settings from anon, authenticated;

-- READ: { "aiModel": text | null }, also when the row does not exist yet
create function public.get_workspace_settings()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('aiModel', (select s.ai_model from public.workspace_settings s where s.id));
$$;

-- WRITE: sets the chosen model (null clears it); returns the settings as get_workspace_settings does
create function public.set_ai_model(p_model text)
returns jsonb
language sql
set search_path = ''
as $$
  insert into public.workspace_settings (id, ai_model, updated_at)
  values (true, nullif(btrim(p_model), ''), now())
  on conflict (id) do update set ai_model = excluded.ai_model, updated_at = excluded.updated_at;
  select public.get_workspace_settings();
$$;

revoke execute on function public.get_workspace_settings() from public, anon, authenticated;
revoke execute on function public.set_ai_model(text) from public, anon, authenticated;
grant execute on function public.get_workspace_settings() to service_role;
grant execute on function public.set_ai_model(text) to service_role;
