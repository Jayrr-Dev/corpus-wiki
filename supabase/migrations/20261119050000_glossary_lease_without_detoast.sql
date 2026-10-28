-- Taking the glossary lease updates the same row as the comparison cache.
-- The old checkpoint trigger read that whole cache on every update, including a
-- lease. On this storage engine that detoast drops the API connection, so the
-- lease commits and the caller never hears the token.
-- Reset the cursor without touching the cache. Read the cache only when this
-- update is replacing it, and then the new value is already in memory.

create or replace function change_control.reset_glossary_live_cursor() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.status='ready' or new.live_input_hash is null or new.live_input_hash is distinct from old.live_input_hash then
    new.live_completed:=0;
  end if;
  return new;
end $$;

create or replace function change_control.preserve_glossary_live_checkpoint() returns trigger
language plpgsql set search_path='' as $$
declare progress jsonb; position integer;
begin
  if new.status='ready' or new.live_input_hash is null then
    new.live_completed:=0;
    return new;
  end if;
  if new.live_input_hash is distinct from old.live_input_hash then
    new.live_completed:=0;
    return new;
  end if;
  progress:=new.review_cache->'review_progress';
  position:=case when progress->>'phase'='comparing' then coalesce((progress->>'completed')::integer,0) else 0 end;
  if position<old.live_completed then
    new.live_entries:=old.live_entries;
    new.live_completed:=old.live_completed;
  else
    new.live_completed:=position;
  end if;
  return new;
end $$;

drop trigger if exists preserve_glossary_live_checkpoint on public.glossary_state;
drop trigger if exists reset_glossary_live_cursor on public.glossary_state;

create trigger reset_glossary_live_cursor before update of status, live_input_hash on public.glossary_state
  for each row execute function change_control.reset_glossary_live_cursor();
create trigger preserve_glossary_live_checkpoint before update of review_cache on public.glossary_state
  for each row execute function change_control.preserve_glossary_live_checkpoint();

notify pgrst, 'reload schema';
