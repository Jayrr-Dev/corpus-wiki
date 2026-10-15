-- =====================================================================
-- SECOND BRAIN · SOURCE LIFECYCLE
-- =====================================================================
-- A source (an uploaded file) can now be replaced, archived, deleted or
-- purged. What happens to the knowledge that cites it is DECLARED, not
-- stored, so it can never drift from the evidence:
--   replace  the old file is archived and points at its newer version;
--            the new file is reconciled like any upload
--   archive  the file stays; knowledge citing it is STALE
--   delete   the file and its passages go; knowledge citing it is LOST
--   purge    (app code) knowledge only it supports is retired, shared
--            knowledge drops its citations, then the file goes
-- =====================================================================

alter table public.sources
  add column archived_at timestamptz,
  add column replaced_by_id uuid references public.sources (id) on delete set null;
comment on column public.sources.archived_at is 'Set when the file is archived or replaced. Knowledge citing it is stale.';
comment on column public.sources.replaced_by_id is 'The newer version of this file, when it was replaced.';


-- =====================================================================
-- VIEWS (security_invoker: the reader's RLS applies)
-- =====================================================================

-- UNIT EVIDENCE: the state of the sources behind each unit's current revision.
-- The worst one wins: a cited passage that no longer exists makes it lost,
-- a cited file that is archived makes it stale.
--   unsourced  no passages cited (a person's own claim)
--   lost       a cited passage is gone (its file was deleted)
--   stale      a cited file is archived or replaced
--   sourced    every cited file is active
create view public.unit_evidence with (security_invoker = true) as
select u.id as unit_id,
  case
    when cardinality(r.passage_ids) = 0 then 'unsourced'
    when exists (
      select 1 from unnest(r.passage_ids) as cited(passage_id)
      where not exists (select 1 from public.passages p where p.id = cited.passage_id)
    ) then 'lost'
    when exists (
      select 1 from public.passages p
      join public.sources s on s.id = p.source_id
      where p.id = any (r.passage_ids) and s.archived_at is not null
    ) then 'stale'
    else 'sourced'
  end as evidence
from public.units u
join public.revisions r on r.id = u.current_revision_id;

-- SOURCE UNITS: which units' current revisions cite each file
create view public.source_units with (security_invoker = true) as
select distinct p.source_id, u.id as unit_id
from public.units u
join public.revisions r on r.id = u.current_revision_id
join public.passages p on p.id = any (r.passage_ids);

revoke all on public.unit_evidence, public.source_units from anon, authenticated;
grant select on public.unit_evidence, public.source_units to authenticated, service_role;
