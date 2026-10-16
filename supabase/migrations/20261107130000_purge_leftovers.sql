-- =====================================================================
-- PURGE LEAVES A CLEAN SLATE: a purge used to retire the file's claims
-- but leave the topics and entities its uploads created, live and empty
-- (an "EPCOR" root approved for one file was then reused by the next
-- upload without asking), and its upload processing still "running".
-- =====================================================================

-- WHAT A PURGE LEAVES OVER: the article pages, topics and entities this file's uploads created
-- that nothing will use once p_retiring (the units the purge retires) are gone.
--   page    stays when a live line states another live claim, or a person wrote a line
--   topic   stays when its subtree holds another live claim, a topic another file created,
--           or a page or section that stays (a domain tab listing a root the file created
--           does not keep it: tabs show live roots only, and undo brings it back)
--   entity  stays when another live claim names it, a page or section that stays is about it,
--           or a topic that stays is its context
-- Only the highest topic of a leftover branch is returned (retiring it retires its subtree).
create function public.purge_leftovers(p_source_id uuid, p_retiring uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  with created as (
    select a.type::text as type, a.target_id
    from public.actions a
    join public.change_sets c on c.id = a.change_set_id
    join public.shift_events e on e.id = c.event_id
    where e.source_id = p_source_id and a.outcome = 'applied' and a.target_id is not null
      and a.type::text in ('create_domain', 'create_entity', 'create_page')
  ),
  leftover_pages as (
    select p.id from public.pages p
    where p.retired_at is null and p.id in (select target_id from created where type = 'create_page')
      and not exists (
        select 1 from public.sections x join public.lines l on l.section_id = x.id and l.retired_at is null
        join public.line_revisions lr on lr.id = l.current_revision_id
        where x.page_id = p.id and x.retired_at is null and (lr.author::text = 'person' or exists (
          select 1 from unnest(lr.unit_revision_ids) rid join public.revisions r on r.id = rid
          join public.units u on u.id = r.unit_id where u.retired_at is null and not (u.id = any (p_retiring)))))
  ),
  kept_pages as (
    select p.* from public.pages p where p.retired_at is null and p.id not in (select id from leftover_pages)
  ),
  kept_sections as (
    select x.* from public.sections x where x.retired_at is null and x.page_id not in (select id from leftover_pages)
  ),
  file_domains as (
    select d.* from public.domains d where d.retired_at is null and d.id in (select target_id from created where type = 'create_domain')
  ),
  subtree as (
    select f.id as top, x.id, x.path from file_domains f
    join public.domains x on (x.path = f.path or starts_with(x.path, f.path || '/')) and x.retired_at is null
  ),
  kept_domains as (
    select distinct s.top from subtree s
    where s.id not in (select id from file_domains)
      or exists (select 1 from public.unit_domains ud join public.units u on u.id = ud.unit_id
        where ud.domain_id = s.id and u.retired_at is null and not (u.id = any (p_retiring)))
      or exists (select 1 from kept_pages p where p.domain_id = s.id)
      or exists (select 1 from kept_sections x where jsonb_typeof(x.query -> 'domainPaths') = 'array'
        and exists (select 1 from jsonb_array_elements_text(x.query -> 'domainPaths') v where v = s.path or starts_with(v, s.path || '/')))
  ),
  leftover_domains as (
    select f.* from file_domains f where f.id not in (select top from kept_domains)
  ),
  top_domains as (
    select l.id from leftover_domains l
    where not exists (select 1 from leftover_domains above where starts_with(l.path, above.path || '/'))
  ),
  leftover_entities as (
    select e.id from public.entities e
    where e.retired_at is null and e.merged_into_id is null
      and e.id in (select target_id from created where type = 'create_entity')
      and not exists (select 1 from public.unit_entities ue join public.units u on u.id = ue.unit_id
        where ue.entity_id = e.id and u.retired_at is null and not (u.id = any (p_retiring)))
      and not exists (select 1 from kept_pages p where p.context_entity_id = e.id)
      and not exists (select 1 from kept_sections x
        where x.query -> 'entity' ->> 'type' = e.type and x.query -> 'entity' ->> 'key' = e.key)
      and not exists (select 1 from public.domains d where d.context_entity_id = e.id and d.retired_at is null
        and d.id not in (select id from leftover_domains))
  )
  select jsonb_build_object(
    'pageIds', coalesce((select jsonb_agg(id) from leftover_pages), '[]'::jsonb),
    'domainIds', coalesce((select jsonb_agg(id) from top_domains), '[]'::jsonb),
    'entityIds', coalesce((select jsonb_agg(id) from leftover_entities), '[]'::jsonb)
  )
$$;
revoke all on function public.purge_leftovers(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.purge_leftovers(uuid, uuid[]) to service_role;

-- A REMOVED FILE'S UPLOADS STOP: their processing is closed (it can no longer be resumed,
-- and a run still going stops at its next lease check, which needs the source)
create function public.close_source_uploads(p_source_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.upload_workflows w
  set state = 'complete', error = 'The file was removed, so its processing stopped.',
    token = null, lease_until = null, progress = null, resume_requested = false, updated_at = now()
  where w.state <> 'complete'
    and w.event_id in (select e.id from public.shift_events e where e.source_id = p_source_id)
$$;
revoke all on function public.close_source_uploads(uuid) from public, anon, authenticated;
grant execute on function public.close_source_uploads(uuid) to service_role;
