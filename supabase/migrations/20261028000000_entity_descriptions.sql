-- ENTITY DESCRIPTIONS
-- A short AI-written summary of what an entity is, grounded only in the units
-- (and their cited passages) that mention it. Written after an upload for the
-- entities it created, and backfilled from /graph. Null until written.

alter table public.entities add column description text;
alter table public.entities add column description_updated_at timestamptz;
