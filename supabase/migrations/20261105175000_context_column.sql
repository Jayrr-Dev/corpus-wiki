-- Keep OrioleDB column metadata changes in a separate committed transaction
-- from updates of existing rows. The combined ADD COLUMN + backfill crashed
-- the project's preview engine during the backfill (XX000 undo-chain panic).
alter table public.revisions add column if not exists knowledge_context jsonb;
