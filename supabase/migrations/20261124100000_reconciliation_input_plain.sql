-- =====================================================================
-- RECONCILIATION INPUT IN ONE PLACE (issue #48, scoped)
-- reconciliation_input had grown as a chain of wrappers: the base query,
-- then domain tabs, knowledge context, structure and members, and canonical
-- entity refs, each renaming the previous version to *_before_*. This
-- replaces the chain with one plain definition that returns the same JSON,
-- and drops the old layers.
--
--   source         the uploaded file
--   passages       its passages, in order
--   existingUnits  every live claim, oldest first, with its current
--                  revision, knowledge context, shape and ordered members
--   domainPaths    live topics
--   entities       live, unmerged entities
--   domainTabs     the person's tabs and their live root topics
-- (lib/ai/types.ts ReconciliationInput)
-- =====================================================================

create or replace function public.reconciliation_input(p_event_id uuid)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'source', jsonb_build_object('id', s.id, 'title', s.title, 'sourceDate', s.source_date),
    'passages', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'position', p.position, 'text', p.text, 'speakerLabel', p.speaker_label)
                       order by p.position)
      from public.passages p where p.source_id = s.id), '[]'),
    'existingUnits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unitId', u.id, 'revisionId', r.id, 'content', r.content, 'kind', u.kind,
        'epistemicStatus', u.epistemic_status, 'sourceDate', r.source_date, 'passageIds', to_jsonb(r.passage_ids),
        'context', public.canonical_knowledge_context(coalesce(r.knowledge_context, 'null'::jsonb)),
        'structure', r.structure,
        'memberUnitIds', coalesce((
          select jsonb_agg(l.from_unit_id order by l.position nulls last, l.created_at, l.id)
          from public.relationships l join public.units m on m.id = l.from_unit_id
          where l.to_unit_id = u.id and l.type = 'part_of' and l.retired_at is null and m.retired_at is null
        ), '[]'::jsonb)
      ) order by u.created_at)
      from public.units u join public.revisions r on r.id = u.current_revision_id
      where u.retired_at is null), '[]'),
    'domainPaths', coalesce((select jsonb_agg(d.path order by d.path) from public.domains d where d.retired_at is null), '[]'),
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object('type', e.type, 'key', e.key, 'name', e.name) order by e.type, e.key)
      from public.entities e where e.merged_into_id is null and e.retired_at is null), '[]'),
    'domainTabs', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'description', t.description, 'rootPaths',
        coalesce((select jsonb_agg(d.path order by d.path) from public.domains d
          where d.id = any(t.root_ids) and d.parent_id is null and d.retired_at is null), '[]'::jsonb)))
      from public.domain_tabs t), '[]'::jsonb)
  )
  from public.shift_events ev join public.sources s on s.id = ev.source_id
  where ev.id = p_event_id
$$;
revoke all on function public.reconciliation_input(uuid) from public, anon, authenticated;
grant execute on function public.reconciliation_input(uuid) to service_role;

-- The old layers: nothing else calls them
drop function public.reconciliation_input_before_entity_types(uuid);
drop function public.reconciliation_input_before_structure(uuid);
drop function public.reconciliation_input_before_context(uuid);
drop function public.reconciliation_input_before_tabs(uuid);
