-- =====================================================================
-- CURATOR, TUNED AFTER ITS FIRST BENCHMARK (20261109150000_curator.sql)
-- 1. A confident merge that moves no claims (the page says nothing the
--    other does not) applies at once, undoable in Changes. Moves, merges
--    that bring claims over, and anything the Curator is unsure of still
--    wait on Exceptions. On a snapshot of the live wiki this cut a run from 25 Exceptions to 10.
-- 2. The snapshot marks organization pages (titled with the name or an alias
--    of a live organization entity), which the Curator keeps as parents and
--    never merges away.
-- =====================================================================

create or replace function change_control.judge(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_result jsonb := change_control.judge_before_curator(p_action, p_proposed_by);
begin
  if p_action.type::text <> 'update_page' or p_proposed_by <> 'ai' or v_result ->> 'outcome' <> 'applied' then
    return v_result;
  end if;
  if p_action.input ->> 'confident' is distinct from 'true' or p_action.input ->> 'operation' = 'move'
     or (p_action.input ->> 'operation' = 'merge' and jsonb_array_length(coalesce(p_action.input -> 'unitIds', '[]')) > 0) then
    return jsonb_build_object('outcome', 'exception', 'reason', 'page_structure_review',
      'detail', p_action.input ->> 'reason', 'checks', v_result -> 'checks');
  end if;
  return v_result;
end $$;

create or replace function public.curator_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
  claim_ids as (select distinct unit_id from page_claims)
  select jsonb_build_object(
    'pages', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'parentId', p.parent_page_id,
      'articleType', p.article_type, 'scope', p.scope,
      'contextName', coalesce(ce.name, case when e.type in ('company','organization','project','person','team','product') then e.name end),
      -- An organization's own page: titled with the name (or an alias) of a live organization entity
      'organization', exists (select 1 from public.entities o
        where o.retired_at is null and o.merged_into_id is null and o.type in ('company','organization','project','person','team','product')
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
    'vectors', coalesce((select jsonb_agg(jsonb_build_object('id', v.unit_id, 'vector', v.embedding::text))
    from (select distinct on (ue.unit_id) ue.unit_id, ue.embedding
          from public.unit_embeddings ue join claim_ids c on c.unit_id = ue.unit_id
          join public.units u on u.id = ue.unit_id
          order by ue.unit_id, (ue.revision_id = u.current_revision_id) desc, ue.created_at desc) v), '[]')
  )
$$;

revoke all on function public.curator_snapshot() from public, anon, authenticated;
grant execute on function public.curator_snapshot() to service_role;
revoke execute on all functions in schema change_control from public, anon, authenticated;
