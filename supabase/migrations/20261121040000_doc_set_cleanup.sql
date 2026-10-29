-- =====================================================================
-- SECOND BRAIN · DOCS CLEANUP
-- =====================================================================
-- Clean on /docs (app/(app)/docs/actions.ts) keeps one doc set per source
-- and retires the rest (lib/docs/clean.ts picks which). A retired set and
-- its pages are hidden, never deleted: they share one retired_at stamp so
-- they can be brought back together.
-- B-tree indexes only (OrioleDB, AGENTS.md).
-- =====================================================================

alter table public.doc_sets add column retired_at timestamptz;
comment on column public.doc_sets.retired_at is 'Set when Clean retired this set as a duplicate; its pages carry the same stamp.';

grant create on schema public to space_runtime;

-- WRITE: retires doc sets and their live pages. Returns how many sets were retired.
create function public.retire_doc_sets(p_doc_set_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_ids uuid[];
begin
  update public.doc_sets set retired_at = v_now, updated_at = v_now
  where id = any (p_doc_set_ids) and space_id = public.current_space_id() and retired_at is null and status <> 'writing';
  select coalesce(array_agg(id), '{}') into v_ids from public.doc_sets where id = any (p_doc_set_ids) and retired_at = v_now;
  update public.pages set retired_at = v_now where doc_set_id = any (v_ids) and retired_at is null;
  return coalesce(array_length(v_ids, 1), 0);
end $$;

-- READS see live sets only (otherwise as in 20261120200000_docs.sql)
create or replace function public.list_doc_sets()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'title', d.title, 'scopeKind', d.scope_kind, 'scopeId', d.scope_id, 'coverage', d.coverage,
    'status', d.status, 'error', d.error, 'createdAt', d.created_at,
    'pageCount', (select count(*) from public.pages p where p.doc_set_id = d.id and p.retired_at is null),
    'updatedAt', greatest(d.updated_at, (select max(s.built_at) from public.sections s join public.pages p on p.id = s.page_id
                                         where p.doc_set_id = d.id and p.retired_at is null and s.retired_at is null)),
    'stalePages', (select count(*) from public.pages p where p.doc_set_id = d.id and p.retired_at is null and (
      exists (select 1 from public.section_lines sl where sl.page_id = p.id and sl.is_stale)
      or exists (select 1 from public.sections s where s.page_id = p.id and s.retired_at is null and s.status = 'stale' and s.built_at is not null)))
  ) order by d.created_at desc, d.id), '[]'::jsonb)
  from public.doc_sets d
  where d.space_id = public.current_space_id() and d.retired_at is null;
$$;

create or replace function public.read_doc_set(p_doc_set_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when d.id is null then null else jsonb_build_object(
    'id', d.id, 'title', d.title, 'scopeKind', d.scope_kind, 'scopeId', d.scope_id, 'coverage', d.coverage,
    'status', d.status, 'error', d.error, 'createdAt', d.created_at, 'updatedAt', d.updated_at,
    'pages', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'slug', p.slug, 'position', p.doc_position, 'group', p.doc_group,
      'sections', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'intro', coalesce(s.query ->> 'docPart', '') = 'intro',
        'status', s.status, 'builtAt', s.built_at,
        'lines', coalesce((select jsonb_agg(jsonb_build_object(
          'lineId', sl.line_id, 'content', sl.content, 'unitRevisionIds', to_jsonb(sl.unit_revision_ids), 'isStale', coalesce(sl.is_stale, false)
        ) order by sl.position) from public.section_lines sl where sl.section_id = s.id), '[]'::jsonb)
      ) order by s.position) from public.sections s where s.page_id = p.id and s.retired_at is null), '[]'::jsonb)
    ) order by p.doc_position, p.id) from public.pages p where p.doc_set_id = d.id and p.retired_at is null), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(jsonb_build_object('revisionId', r.id, 'unitId', r.unit_id, 'title', r.title, 'content', r.content))
      from public.revisions r
      where r.id in (select distinct cited from public.section_lines sl
                     join public.pages p on p.id = sl.page_id
                     cross join unnest(sl.unit_revision_ids) cited
                     where p.doc_set_id = d.id and p.retired_at is null)), '[]'::jsonb)
  ) end
  from (select 1) anchor
  left join public.doc_sets d on d.id = p_doc_set_id and d.space_id = public.current_space_id() and d.retired_at is null;
$$;

create or replace function public.list_doc_set_pages(p_doc_set_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(p.id order by p.doc_position, p.id), '[]'::jsonb)
  from public.pages p
  join public.doc_sets d on d.id = p.doc_set_id and d.space_id = public.current_space_id() and d.retired_at is null
  where p.doc_set_id = p_doc_set_id and p.retired_at is null;
$$;

alter function public.retire_doc_sets(uuid[]) owner to space_runtime;
revoke execute on function public.retire_doc_sets(uuid[]) from public, anon, authenticated;
grant execute on function public.retire_doc_sets(uuid[]) to service_role, space_runtime;

revoke create on schema public from space_runtime;

notify pgrst, 'reload schema';
