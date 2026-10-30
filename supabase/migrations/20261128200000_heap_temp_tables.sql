-- Temporary tables use heap, not OrioleDB. The database default is orioledb, so the temp table in
-- organize_entity_context (every upload's topic step) was an OrioleDB table, and creating it
-- crashed the server: "undo_read(): undo record was cleaned concurrently with the read", then
-- "all server processes terminated; reinitializing" (4 times on 2026-10-30). sync_assets has the
-- same pattern. Only the CREATE line changes; the live definitions are edited in place because
-- the spaces migration rewrote them after their source files.
do $$
declare f record; definition text; changed text;
begin
  for f in select * from (values
    ('public.organize_entity_context(uuid)', 'hierarchy_owners(unit_id uuid primary key, owner uuid) on commit drop',
      'hierarchy_owners(unit_id uuid primary key, owner uuid) using heap on commit drop'),
    ('public.sync_assets()', 'create temp table media_found on commit drop as', 'create temp table media_found using heap on commit drop as')
  ) as t(signature, old, new) loop
    definition := pg_get_functiondef(f.signature::regprocedure);
    changed := replace(definition, f.old, f.new);
    if changed = definition then raise exception 'The temp table line of % was not found', f.signature; end if;
    execute changed;
  end loop;
end $$;
