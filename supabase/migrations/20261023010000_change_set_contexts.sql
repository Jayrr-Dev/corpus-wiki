-- =====================================================================
-- CHANGE SET CONTEXTS: what the Changes list shows per row (the action
-- types, the sections, articles and domains they landed in, the first
-- new line), worked out in the database, one row per change set asked
-- for. Before this the browser read every action and resolved them itself.
--
-- security invoker: the caller's RLS applies to every table it reads,
-- so it shows no more than the reader could select themselves.
-- =====================================================================

-- A uuid from text, or null when it is not one (action inputs are JSON)
create function public.uuid_or_null(p_value text)
returns uuid
language sql
immutable
as $$
  select case when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid end
$$;

create function public.change_set_contexts(p_change_set_ids uuid[])
returns table (
  change_set_id uuid,
  action_types public.action_type[],
  action_count integer,
  line_action_count integer,
  first_line_content text,
  section_titles text[],
  article_titles text[],
  domain_names text[],
  domain_paths text[],
  claim_domain_paths text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  with placed as (
    -- each action with the section, page and domain it touched (any may be null)
    select a.change_set_id, a.id, a.type, a.position, a.input,
           s.title as section_title, pg.title as page_title, d.name as domain_name, d.path as domain_path
    from public.actions a
    left join public.lines l
      on a.type in ('revise_line', 'retire_line', 'move_line') and l.id = a.target_id
    left join public.sections s on s.id = case
      when a.type = 'write_line' then public.uuid_or_null(a.input ->> 'sectionId')
      when a.type in ('revise_line', 'retire_line', 'move_line') then l.section_id
      when a.type in ('create_section', 'rename_section', 'retire_section') then a.target_id
    end
    left join public.pages pg on pg.id = case
      when s.id is not null then s.page_id
      when a.type = 'create_section' then public.uuid_or_null(a.input ->> 'pageId')
      when a.type in ('create_page', 'rename_page', 'retire_page') then a.target_id
    end
    -- a claim, merge or link is placed by its unit's deepest domain
    left join lateral (
      select ud.domain_id
      from public.unit_domains ud
      join public.domains dd on dd.id = ud.domain_id
      where a.type in ('add_claim', 'revise_claim', 'retire_claim', 'set_epistemic_status', 'merge_duplicates', 'link')
        and ud.unit_id = a.target_id
      order by length(dd.path) desc
      limit 1
    ) unit_domain on true
    left join public.domains d on d.id = coalesce(
      pg.domain_id,
      case when a.type in ('update_domain', 'retire_domain') then a.target_id end,
      unit_domain.domain_id
    )
    where a.change_set_id = any (p_change_set_ids)
  ),
  claim_paths as (
    -- domains an added claim or a new domain names by path (before it has a unit)
    select p.change_set_id, path
    from placed p
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(p.input -> 'domainPaths') = 'array' then p.input -> 'domainPaths' else '[]'::jsonb end
    ) as path
    union
    select p.change_set_id, p.input ->> 'path'
    from placed p
    where p.type = 'create_domain' and coalesce(p.input ->> 'path', '') <> ''
  )
  select
    p.change_set_id,
    array_agg(distinct p.type),
    count(*)::integer,
    (count(*) filter (where p.type in ('write_line', 'revise_line', 'retire_line', 'move_line')))::integer,
    (array_agg(p.input ->> 'content' order by p.position)
      filter (where p.type in ('write_line', 'revise_line') and coalesce(p.input ->> 'content', '') <> ''))[1],
    coalesce(array_agg(distinct coalesce(p.section_title, p.input ->> 'title'))
      filter (where p.section_title is not null or (p.type = 'create_section' and p.input ->> 'title' is not null)), '{}'),
    coalesce(array_agg(distinct coalesce(p.page_title, p.input ->> 'title'))
      filter (where p.page_title is not null or (p.type = 'create_page' and p.input ->> 'title' is not null)), '{}'),
    coalesce(array_agg(distinct p.domain_name) filter (where p.domain_name is not null), '{}'),
    coalesce(array_agg(distinct p.domain_path) filter (where p.domain_path is not null), '{}'),
    coalesce((select array_agg(c.path order by c.path) from claim_paths c where c.change_set_id = p.change_set_id), '{}')
  from placed p
  group by p.change_set_id
$$;

revoke execute on function public.change_set_contexts(uuid[]) from public, anon;
grant execute on function public.change_set_contexts(uuid[]) to authenticated;
