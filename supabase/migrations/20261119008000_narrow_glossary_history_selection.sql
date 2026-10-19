-- Choose the old history record using only its indexed identity. Loading whole
-- action rows while sorting/offsetting can read twenty large dictionary copies.
create or replace function change_control.compact_new_glossary_history() returns trigger
language plpgsql set search_path='' set jit=off as $$
declare compacted jsonb; previous_id uuid; input_text text; undo_text text; previous_input jsonb;
begin
  if new.type::text='glossary_update' then
    select a.id into previous_id from public.actions a
      where a.type='glossary_update' and a.space_id=new.space_id
      order by a.created_at desc,a.id desc offset 19 limit 1;
    if previous_id is not null and right(previous_id::text,1)<>'0' then
      -- Hold the same row lock as before. Copy toasted fields independently.
      select a.input::text into input_text from public.actions a where a.id=previous_id for update;
      previous_input:=input_text::jsonb;
      if not previous_input ? 'glossaryDelta' then
        select a.undo_state::text into undo_text from public.actions a where a.id=previous_id;
        compacted:=change_control.compact_glossary_history(previous_input,undo_text::jsonb);
        update public.actions set input=compacted->'input',undo_state=compacted->'undo_state' where id=previous_id;
      end if;
    end if;
  end if;
  return new;
end $$;
notify pgrst,'reload schema';
