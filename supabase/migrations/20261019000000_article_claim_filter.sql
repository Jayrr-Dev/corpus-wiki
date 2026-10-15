-- Add claim-scoped topic sections; existing entity/domain/kind queries keep their behavior.
create or replace function public.living_page_query_units(p_query jsonb)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select u.id
  from public.units u
  where p_query is not null
    and u.retired_at is null
    -- Topic sections select explicit verified claims. An empty list selects nothing.
    and (
      jsonb_typeof(p_query -> 'unitIds') is distinct from 'array'
      or u.id::text in (select jsonb_array_elements_text(p_query -> 'unitIds'))
    )
    -- ENTITY: linked to (type, key) when given
    and (
      jsonb_typeof(p_query -> 'entity') is distinct from 'object'
      or exists (
        select 1
        from public.unit_entities ue
        join public.entities e on e.id = ue.entity_id
        where ue.unit_id = u.id
          and e.type = p_query -> 'entity' ->> 'type'
          and e.key = p_query -> 'entity' ->> 'key'
      )
    )
    -- DOMAINS: in a listed domain or below it (compared by path prefix, not LIKE)
    and (
      jsonb_typeof(p_query -> 'domainPaths') is distinct from 'array'
      or jsonb_array_length(p_query -> 'domainPaths') = 0
      or exists (
        select 1
        from public.unit_domains ud
        join public.domains d on d.id = ud.domain_id
        cross join jsonb_array_elements_text(p_query -> 'domainPaths') as wanted(path)
        where ud.unit_id = u.id
          and (d.path = wanted.path or left(d.path, length(wanted.path) + 1) = wanted.path || '/')
      )
    )
    -- KINDS: one of the listed kinds
    and (
      jsonb_typeof(p_query -> 'kinds') is distinct from 'array'
      or jsonb_array_length(p_query -> 'kinds') = 0
      or u.kind::text in (select jsonb_array_elements_text(p_query -> 'kinds'))
    );
$$;
