-- Supabase Realtime "Postgres Changes" decodes the change log for these tables, and on OrioleDB
-- that decoder crashed the server: PANIC "undo_read(): undo record was cleaned concurrently with
-- the read" in realtime.list_changes (realtime_rls), 8 times on 2026-10-30, each followed by
-- "all server processes terminated; reinitializing". The app now refreshes open screens on a timer
-- (lib/realtime/useRealtimeInvalidation.ts), so no table stays in the publication. Don't add any back.
do $$
declare t record;
begin
  for t in select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' loop
    execute format('alter publication supabase_realtime drop table %I.%I', t.schemaname, t.tablename);
  end loop;
end $$;
