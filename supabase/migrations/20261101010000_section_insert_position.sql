-- =====================================================================
-- SECOND BRAIN · CREATE SECTION AT A POSITION (fix)
-- =====================================================================
-- sections has unique (page_id, position), checked row by row, so moving
-- the later sections down with one "position + 1" update collides with
-- the next row. They move in two steps instead: out to negative
-- positions first, then back to their new places.
-- =====================================================================

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
    update public.sections set position = -(position + 1) where page_id = v_page_id and position >= v_position;
    update public.sections set position = -position where page_id = v_page_id and position < 0;
    insert into public.sections (page_id, position, title, mode, query, status)
    values (v_page_id, v_position, trim(p_action.input ->> 'title'), 'generated', p_action.input -> 'query', 'stale')
    returning id into v_section_id;
  end if;
  update public.actions set target_id = v_section_id, undo_state = '{}' where id = p_action.id;
end $$;
