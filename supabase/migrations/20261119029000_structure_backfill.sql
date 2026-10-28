-- =====================================================================
-- STRUCTURE BACKFILL: links for claims saved before structure labels
-- =====================================================================
-- Claims saved before 20261119028000 carry no knowledge_context.structure.
-- Revising each one through Change control would mark every section that
-- uses it stale and rewrite pages with no change in fact, so a backfill
-- writes the links it reads from a claim straight into entity_relations,
-- checked by the same validator, flagged backfilled.
-- 1. BACKFILLED ROWS SURVIVE a re-projection of a claim whose context
--    still has no structure; a revision that labels its own replaces them.
-- 2. CANDIDATES: live claims without structure naming a stakeholder and
--    at least one other entity, with each entity's name.
-- 3. BACKFILL_STRUCTURE(unit, labels): validates the labels against the
--    claim's own entities and replaces that claim's backfilled rows.
-- =====================================================================

grant create on schema public, change_control to space_runtime;

alter table public.entity_relations add column backfilled boolean not null default false;
comment on column public.entity_relations.backfilled is 'Written by backfill_structure for a claim saved before structure labels, not projected from its context.';


-- =====================================================================
-- 1. PROJECTION: the 20261119028000 version, keeping backfilled rows
-- =====================================================================

alter function change_control.project_knowledge_context(uuid) rename to project_knowledge_context_before_backfill;
create function change_control.project_knowledge_context(p_unit uuid)
returns uuid[]
language plpgsql
set search_path = ''
as $$
declare
  c jsonb;
  kept jsonb := '[]';
  affected uuid[];
begin
  select r.knowledge_context into c from public.units u join public.revisions r on r.id = u.current_revision_id where u.id = p_unit;
  if c is null or not (c ? 'structure') then
    select coalesce(jsonb_agg(to_jsonb(er)), '[]') into kept from public.entity_relations er where er.unit_id = p_unit and er.backfilled;
  end if;
  affected := change_control.project_knowledge_context_before_backfill(p_unit);
  insert into public.entity_relations
  select * from jsonb_populate_recordset(null::public.entity_relations, kept)
  on conflict do nothing;
  return affected;
end $$;

revoke all on function change_control.project_knowledge_context(uuid) from public, anon, authenticated;
grant execute on function change_control.project_knowledge_context(uuid) to service_role, space_runtime;
alter function change_control.project_knowledge_context(uuid) owner to space_runtime;


-- =====================================================================
-- 2. CANDIDATES
-- =====================================================================

create function public.structure_backfill_candidates()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('unitId', u.id, 'content', r.content, 'entities', ents.list) order by u.id), '[]')
  from public.units u
  join public.revisions r on r.id = u.current_revision_id
  cross join lateral (
    select jsonb_agg(jsonb_build_object('type', x ->> 'type', 'key', x ->> 'key', 'name', e.name,
      'stakeholder', coalesce(p.is_stakeholder, false))) list,
      count(*) filter (where p.is_stakeholder) stakeholders, count(*) total
    from jsonb_array_elements(r.knowledge_context -> 'entities') x
    join public.entities e on e.id = public.entity_id_for(x ->> 'type', x ->> 'key')
    left join public.entity_profiles p on p.entity_id = e.id
  ) ents
  where u.retired_at is null and not (r.knowledge_context ? 'structure')
    and ents.stakeholders >= 1 and ents.total >= 2
    and not exists (select 1 from public.entity_relations er where er.unit_id = u.id)
$$;
alter function public.structure_backfill_candidates() owner to space_runtime;
revoke all on function public.structure_backfill_candidates() from public, anon, authenticated;
grant execute on function public.structure_backfill_candidates() to service_role, space_runtime;


-- =====================================================================
-- 3. BACKFILL ONE CLAIM
-- =====================================================================

-- The number of links written; 0 when the claim is gone or labels its own structure
create function public.backfill_structure(p_unit uuid, p_structure jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
  written integer;
begin
  select r.knowledge_context into c from public.units u join public.revisions r on r.id = u.current_revision_id
  where u.id = p_unit and u.retired_at is null;
  if c is null or c ? 'structure' then return 0; end if;
  perform change_control.validate_knowledge_context(c || jsonb_build_object('structure', coalesce(p_structure, '[]')));
  delete from public.entity_relations where unit_id = p_unit and backfilled;
  insert into public.entity_relations (unit_id, from_entity_id, to_entity_id, link, title, seniority, share, current, since, until, backfilled)
  select p_unit, ends.from_id, ends.to_id, x ->> 'link', nullif(btrim(x ->> 'title'), ''), x ->> 'seniority',
    (x ->> 'share')::numeric, coalesce((x ->> 'current')::boolean, true), x ->> 'since', x ->> 'until', true
  from jsonb_array_elements(coalesce(p_structure, '[]')) x
  cross join lateral (select public.entity_id_for(x -> 'from' ->> 'type', x -> 'from' ->> 'key') from_id,
                             public.entity_id_for(x -> 'to' ->> 'type', x -> 'to' ->> 'key') to_id) ends
  where ends.from_id is not null and ends.to_id is not null and ends.from_id <> ends.to_id
  on conflict do nothing;
  get diagnostics written = row_count;
  return written;
end $$;
alter function public.backfill_structure(uuid, jsonb) owner to space_runtime;
revoke all on function public.backfill_structure(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.backfill_structure(uuid, jsonb) to service_role, space_runtime;

revoke create on schema public, change_control from space_runtime;

notify pgrst, 'reload schema';
