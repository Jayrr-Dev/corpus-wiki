-- =====================================================================
-- COMPOSITES: a claim that holds the shape of other claims, such as a
-- procedure and its steps, or a list and its items. The members stay
-- claims of their own, linked to the composite with part_of.
--   revisions.structure    {type: sequence|set, complete, mode: all|any|null}
--                          on the composite; versioned with the claim
--   relationships.position the step's place in a sequence (gaps allowed;
--                          ties fall back to created_at, as lines do)
-- Column changes only: OrioleDB metadata changes stay apart from functions
-- and backfills (see 20261105175000_context_column.sql).
-- =====================================================================
alter table public.revisions add column if not exists structure jsonb;
alter table public.relationships add column if not exists position integer;

comment on column public.revisions.structure is 'Set on a composite claim: {type: sequence|set, complete, mode: all|any|null}. Its members link to it with part_of.';
comment on column public.relationships.position is 'For part_of into a sequence: the member''s place, 1 first.';
