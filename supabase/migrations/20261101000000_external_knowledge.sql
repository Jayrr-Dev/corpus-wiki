-- =====================================================================
-- SECOND BRAIN · EXTERNAL KNOWLEDGE
-- =====================================================================
-- Force Create can fill a section from the web as well as from uploads.
--   sources.origin   'internal' for a file a person uploaded,
--                    'external' for a web page the AI brought in
--   sources.url      where an external source was read from
--   workspace_settings.allow_external_knowledge
--                    off by default: Force Create stays internal-only
--                    until /settings turns it on
--   create_section   an optional input 'position' places the new
--                    section there (later sections move down one), so a
--                    section rebuilt by Force Create keeps its place
-- =====================================================================

alter table public.sources
  add column origin text not null default 'internal' check (origin in ('internal', 'external')),
  add column url text;

alter table public.workspace_settings
  add column allow_external_knowledge boolean not null default false;

create or replace function public.get_workspace_settings()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'aiModel', (select s.ai_model from public.workspace_settings s where s.id),
    'autoUpdateStale', coalesce((select s.auto_update_stale from public.workspace_settings s where s.id), true),
    'allowExternalKnowledge', coalesce((select s.allow_external_knowledge from public.workspace_settings s where s.id), false)
  );
$$;

create function public.set_allow_external_knowledge(p_enabled boolean)
returns jsonb
language sql
set search_path = ''
as $$
  insert into public.workspace_settings (id, allow_external_knowledge, updated_at)
  values (true, p_enabled, now())
  on conflict (id) do update
    set allow_external_knowledge = excluded.allow_external_knowledge, updated_at = excluded.updated_at;
  select public.get_workspace_settings();
$$;

revoke execute on function public.set_allow_external_knowledge(boolean) from public, anon, authenticated;
grant execute on function public.set_allow_external_knowledge(boolean) to service_role;

-- CREATE SECTION: at the end of the page, or at input 'position' when given
create or replace function change_control.apply_create_section(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_page_id uuid := (p_action.input ->> 'pageId')::uuid;
  v_position int := (p_action.input ->> 'position')::int;
  v_section_id uuid;
begin
  if v_position is null then
    v_section_id := change_control.insert_section(v_page_id, p_action.input ->> 'title', p_action.input -> 'query');
  else
    update public.sections set position = position + 1 where page_id = v_page_id and position >= v_position;
    insert into public.sections (page_id, position, title, mode, query, status)
    values (v_page_id, v_position, trim(p_action.input ->> 'title'), 'generated', p_action.input -> 'query', 'stale')
    returning id into v_section_id;
  end if;
  update public.actions set target_id = v_section_id, undo_state = '{}' where id = p_action.id;
end $$;
