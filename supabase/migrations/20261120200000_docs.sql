-- =====================================================================
-- SECOND BRAIN · DOCS
-- =====================================================================
-- Technical docs written from a scope's claims (docs/knowledge-modules-plan.md,
-- section 2). A doc set is a list of doc pages; a doc page is a living page
-- (pages.kind = 'doc') whose sections carry query.style = 'doc', so its lines
-- cite claims, go stale and rebuild exactly like an article's. Each line holds
-- one doc block as JSON (lib/docs/blocks.ts).
-- Doc pages stay out of the wiki's article index and do not take article
-- titles: two doc sets may both have a "Create a cluster" page.
-- B-tree indexes only (OrioleDB, AGENTS.md).
-- =====================================================================

create table public.doc_sets (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null default public.current_space_id() references public.spaces (id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  scope_kind text not null check (scope_kind in ('topic', 'article', 'entity', 'glossary')),
  scope_id uuid,
  coverage smallint not null check (coverage in (25, 50, 100)),
  -- writing: pages are being written; ready: done; failed: see error
  status text not null default 'writing' check (status in ('writing', 'ready', 'failed')),
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope_kind = 'glossary') = (scope_id is null))
);
create index doc_sets_recent on public.doc_sets (space_id, created_at desc);

do $$ begin
  alter table public.doc_sets enable row level security;
  alter table public.doc_sets force row level security;
  create policy space_boundary on public.doc_sets as restrictive for all to space_runtime
    using (space_id = (select public.current_space_id())) with check (space_id = (select public.current_space_id()));
  create policy space_server on public.doc_sets for all to space_runtime using (true) with check (true);
  create policy space_browser_boundary on public.doc_sets for select to authenticated
    using (space_id = any (array(select unnest(public.readable_space_ids()))));
  revoke all on public.doc_sets from public, anon;
  grant select on public.doc_sets to authenticated;
  grant select, insert, update, delete on public.doc_sets to space_runtime, service_role;
end $$;

-- DOC PAGES: a page is an article (the wiki) or a doc page (a doc set's, in its order)
alter table public.pages
  add column kind text not null default 'article' check (kind in ('article', 'doc')),
  add column doc_set_id uuid references public.doc_sets (id),
  add column doc_position integer,
  add column doc_group text check (doc_group is null or doc_group in ('set_up', 'use', 'change', 'remove'));
alter table public.pages
  add constraint pages_doc_shape check ((kind = 'doc') = (doc_set_id is not null and doc_position is not null));
create index pages_doc_set on public.pages (doc_set_id, doc_position) where doc_set_id is not null;

-- One live article per title; doc pages are unique within their set instead
drop index public.pages_live_title;
create unique index pages_live_title on public.pages (space_id, lower(btrim(title))) where retired_at is null and kind = 'article';
create unique index pages_doc_title on public.pages (doc_set_id, lower(btrim(title))) where retired_at is null and doc_set_id is not null;

grant create on schema public, change_control to space_runtime;

-- CHECK: a new or renamed article may not take another live article's title (doc pages do not count)
create or replace function change_control.check_page(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_title text := lower(btrim(coalesce(p_action.input ->> 'title', '')));
  v_taken text;
begin
  if p_action.type::text in ('create_page', 'rename_page') and v_title <> '' then
    select title into v_taken from public.pages
    where space_id = public.current_space_id() and retired_at is null and kind = 'article'
      and lower(btrim(title)) = v_title
      and id is distinct from case when p_action.type::text = 'rename_page' then p_action.target_id end
    limit 1;
    if v_taken is not null then
      return change_control.check('page', false, format('A page called “%s” already exists.', v_taken));
    end if;
  end if;
  return change_control.check_page_before_unique_title(p_action, p_proposed_by);
end $$;

-- ARTICLE INDEX: articles only; the article planner never sees doc pages
create or replace function public.article_index()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'type', p.article_type, 'scope', p.scope, 'parentId', p.parent_page_id,
    'claimCount', (select count(distinct cited) from public.section_lines sl cross join unnest(sl.unit_revision_ids) cited where sl.page_id = p.id)
  ) order by p.title), '[]'::jsonb)
  from public.pages p
  where p.retired_at is null and p.kind = 'article';
$$;

-- WRITE: a doc set and its pages from an approved outline, in one transaction.
-- p_pages: [{ title, group, introUnitIds[], sections: [{ title, unitIds[] }] }]. Each page gets an
-- intro section (when it has intro claims) and one section per task; their lines are written
-- afterwards by the Docs writer (lib/docs/write.ts). Returns { docSetId, pageIds[] }.
create function public.create_doc_set(p_title text, p_scope_kind text, p_scope_id uuid, p_coverage integer, p_pages jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_set uuid;
  v_page jsonb;
  v_section jsonb;
  v_page_id uuid;
  v_title text;
  v_position integer := 0;
  v_pages uuid[] := '{}';
begin
  if jsonb_typeof(p_pages) is distinct from 'array' or jsonb_array_length(p_pages) = 0 then
    raise exception 'A doc set needs at least one page' using errcode = '22023';
  end if;
  insert into public.doc_sets (title, scope_kind, scope_id, coverage, created_by)
  values (btrim(p_title), p_scope_kind, p_scope_id, p_coverage,
          nullif(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-person-id', '')::uuid)
  returning id into v_set;
  for v_page in select value from jsonb_array_elements(p_pages) loop
    v_title := btrim(coalesce(v_page ->> 'title', ''));
    if v_title = '' then raise exception 'A doc page needs a title' using errcode = '22023'; end if;
    insert into public.pages (title, slug, kind, doc_set_id, doc_position, doc_group)
    values (v_title, change_control.unique_page_slug(v_title), 'doc', v_set, v_position, nullif(v_page ->> 'group', ''))
    returning id into v_page_id;
    if jsonb_array_length(coalesce(v_page -> 'introUnitIds', '[]')) > 0 then
      perform change_control.insert_section(v_page_id, 'Introduction',
        jsonb_build_object('unitIds', v_page -> 'introUnitIds', 'style', 'doc', 'docPart', 'intro'));
    end if;
    for v_section in select value from jsonb_array_elements(coalesce(v_page -> 'sections', '[]')) loop
      perform change_control.insert_section(v_page_id, v_section ->> 'title',
        jsonb_build_object('unitIds', coalesce(v_section -> 'unitIds', '[]'), 'style', 'doc', 'docPart', 'task'));
    end loop;
    v_pages := v_pages || v_page_id;
    v_position := v_position + 1;
  end loop;
  return jsonb_build_object('docSetId', v_set, 'pageIds', to_jsonb(v_pages));
end $$;

-- WRITE: a doc set's build status (writing while pages are written, then ready or failed)
create function public.set_doc_set_status(p_doc_set_id uuid, p_status text, p_error text default null)
returns void
language sql
set search_path = ''
as $$
  update public.doc_sets set status = p_status, error = case when p_status = 'failed' then p_error end, updated_at = now()
  where id = p_doc_set_id and space_id = public.current_space_id();
$$;

-- READ: the doc sets for /docs, newest first, with their page count, last write and stale pages.
-- A page is stale when a line's claim changed or a section waits for a rebuild after it was written.
create function public.list_doc_sets()
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
  where d.space_id = public.current_space_id();
$$;

-- READ: one doc set for the reader and the export: its pages in order, each page's sections
-- (tasks) with their lines, and the claims those lines cite (shown on hover). Null when not found.
create function public.read_doc_set(p_doc_set_id uuid)
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
  left join public.doc_sets d on d.id = p_doc_set_id and d.space_id = public.current_space_id();
$$;

-- READ: a doc set's live page ids in order (for Rebuild)
create function public.list_doc_set_pages(p_doc_set_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(p.id order by p.doc_position, p.id), '[]'::jsonb)
  from public.pages p
  join public.doc_sets d on d.id = p.doc_set_id and d.space_id = public.current_space_id()
  where p.doc_set_id = p_doc_set_id and p.retired_at is null;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    'public.create_doc_set(text,text,uuid,integer,jsonb)'::regprocedure,
    'public.set_doc_set_status(uuid,text,text)'::regprocedure,
    'public.list_doc_sets()'::regprocedure,
    'public.read_doc_set(uuid)'::regprocedure,
    'public.list_doc_set_pages(uuid)'::regprocedure,
    'public.article_index()'::regprocedure
  ] loop
    execute format('alter function %s owner to space_runtime', signature);
    execute format('revoke execute on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to service_role, space_runtime', signature);
  end loop;
end $$;
alter function change_control.check_page(public.actions, public.actor_kind) owner to space_runtime;
revoke all on function change_control.check_page(public.actions, public.actor_kind) from public, anon, authenticated;
grant execute on function change_control.check_page(public.actions, public.actor_kind) to service_role, space_runtime;

revoke create on schema public, change_control from space_runtime;

notify pgrst, 'reload schema';
