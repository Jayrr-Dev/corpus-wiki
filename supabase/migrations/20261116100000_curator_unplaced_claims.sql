-- =====================================================================
-- CURATOR SEES WHAT IS MISSING. The snapshot only held the claims pages
-- cite, so the Curator could not notice stored knowledge no page shows.
-- 'unplaced' adds every live claim no live line cites (composite members
-- travel with their composite, so they are left out), and 'vectors' now
-- covers them too: the app files each one under the page it is closest to
-- and the Curator can hand that page to the Planner. turnedDown marks a
-- claim the Article Reviewer (the model, not a failed step) already turned
-- down as a new article, so it is not proposed as one again.
-- The rest of the body is as in 20261111110000_context_owner_types.sql.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.curator_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with page_claims as (
    select distinct s.page_id, r.unit_id
    from public.sections s
    join public.lines l on l.section_id = s.id and l.retired_at is null
    join public.line_revisions lr on lr.id = l.current_revision_id
    cross join lateral unnest(lr.unit_revision_ids) as cited(revision_id)
    join public.revisions r on r.id = cited.revision_id
    join public.units u on u.id = r.unit_id and u.retired_at is null
    where s.retired_at is null
  ),
  live_pages as (select * from public.pages where retired_at is null),
  claim_ids as (select distinct unit_id from page_claims),
  unplaced_ids as (
    select u.id as unit_id from public.units u
    where u.retired_at is null
      and not exists (select 1 from claim_ids c where c.unit_id = u.id)
      and not exists (select 1 from public.relationships m where m.from_unit_id = u.id and m.type = 'part_of' and m.retired_at is null)
  )
  select jsonb_build_object(
    'pages', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'parentId', p.parent_page_id,
      'articleType', p.article_type, 'scope', p.scope,
      'contextName', coalesce(ce.name, case when public.entity_type_owns_context(e.type) then e.name end),
      -- An organization's own page: titled with the name (or an alias) of a live organization entity
      'organization', exists (select 1 from public.entities o
        where o.retired_at is null and o.merged_into_id is null and public.entity_type_owns_context(o.type)
          and (lower(o.name) = lower(p.title) or lower(p.title) = any (select lower(a) from unnest(o.aliases) a))),
      'claimIds', coalesce((select jsonb_agg(pc.unit_id order by pc.unit_id) from page_claims pc where pc.page_id = p.id), '[]'),
      'lines', (select count(*) from public.sections s join public.lines l on l.section_id = s.id and l.retired_at is null
                where s.page_id = p.id and s.retired_at is null),
      'sections', coalesce((select jsonb_agg(s.title order by s.position) from public.sections s
                            where s.page_id = p.id and s.retired_at is null), '[]')
    ) order by p.title, p.id)
    from live_pages p
    left join public.entities e on e.id = p.entity_id
    left join public.entities ce on ce.id = p.context_entity_id), '[]'),
    'claims', coalesce((select jsonb_agg(jsonb_build_object(
      'id', u.id, 'title', coalesce(nullif(btrim(r.title), ''), left(r.content, 160))
    ) order by u.id)
    from claim_ids c join public.units u on u.id = c.unit_id join public.revisions r on r.id = u.current_revision_id), '[]'),
    'unplaced', coalesce((select jsonb_agg(jsonb_build_object(
      'id', u.id, 'title', coalesce(nullif(btrim(r.title), ''), left(r.content, 160)),
      'turnedDown', exists (select 1 from public.article_reviews ar
        where ar.verdict = 'reject' and ar.decided_by = 'model' and ar.proposal->'claimIds' ? u.id::text)
    ) order by u.id)
    from unplaced_ids c join public.units u on u.id = c.unit_id join public.revisions r on r.id = u.current_revision_id), '[]'),
    'vectors', coalesce((select jsonb_agg(jsonb_build_object('id', v.unit_id, 'vector', v.embedding::text))
    from (select distinct on (ue.unit_id) ue.unit_id, ue.embedding
          from public.unit_embeddings ue
          join (select unit_id from claim_ids union select unit_id from unplaced_ids) c on c.unit_id = ue.unit_id
          join public.units u on u.id = ue.unit_id
          order by ue.unit_id, (ue.revision_id = u.current_revision_id) desc, ue.created_at desc) v), '[]')
  )
$function$;

revoke all on function public.curator_snapshot() from public, anon, authenticated;
grant execute on function public.curator_snapshot() to service_role;
