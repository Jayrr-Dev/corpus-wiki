-- Recovery replays cached comparisons from the beginning. Preserve the furthest
-- visible checkpoint until replay catches up, rather than shrinking the glossary.
alter table public.glossary_state add column live_completed integer not null default 0;

create function change_control.preserve_glossary_live_checkpoint() returns trigger
language plpgsql set search_path='' as $$
declare progress jsonb; position integer;
begin
 if new.status='ready' or new.live_input_hash is null then new.live_completed:=0; return new; end if;
 progress:=new.review_cache->'review_progress';
 position:=case when progress->>'phase'='comparing' then coalesce((progress->>'completed')::integer,0) else 0 end;
 if new.live_input_hash is distinct from old.live_input_hash then
   new.live_completed:=0;
 elsif position<old.live_completed then
   new.live_entries:=old.live_entries;
   new.live_completed:=old.live_completed;
 else
   new.live_completed:=position;
 end if;
 return new;
end $$;
create trigger preserve_glossary_live_checkpoint before update on public.glossary_state
 for each row execute function change_control.preserve_glossary_live_checkpoint();
notify pgrst,'reload schema';
