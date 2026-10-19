-- Reviewed decisions already supply both snapshots in memory. Store their
-- reversible delta directly instead of reading and rewriting an older 2MB row
-- inside the API's save deadline. Keep periodic full checkpoints unchanged.
do $$
declare definition text; patched text;
begin
  definition:=pg_get_functiondef('change_control.compact_new_glossary_history()'::regprocedure);
  patched:=replace(definition,
    'if new.type::text=''glossary_update'' then',
    'if new.type::text=''glossary_update'' and new.input->>''operation''=''Reviewed'' then
      if right(new.id::text,1)<>''0'' then
        compacted:=change_control.compact_glossary_history(new.input,new.undo_state);
        new.input:=compacted->''input'';
        new.undo_state:=compacted->''undo_state'';
      end if;
      return new;
    end if;
    if new.type::text=''glossary_update'' then');
  if patched=definition then raise exception 'Glossary compaction trigger changed'; end if;
  execute patched;
end $$;
notify pgrst,'reload schema';
