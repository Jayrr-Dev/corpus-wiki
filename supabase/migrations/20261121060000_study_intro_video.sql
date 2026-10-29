-- =====================================================================
-- STUDY INTRO VIDEO: a set can open with its source's video. The set
-- keeps only the choice; the page plays the newest ready video made
-- from the same source (lib/video/intro.ts).
-- =====================================================================

alter table public.study_sets add column intro_video boolean not null default false;

-- space_runtime owns the study functions; it needs CREATE on the schema for the owner change
grant create on schema public to space_runtime;

-- WRITE: a new, empty set; its questions follow in batches (add_study_items)
drop function public.create_study_set(text, text, uuid, integer, text[], uuid);
create function public.create_study_set(p_title text, p_scope_kind text, p_scope_id uuid, p_coverage integer, p_types text[], p_user_id uuid, p_intro_video boolean default false)
returns uuid
language sql
set search_path = ''
as $$
  insert into public.study_sets (title, scope_kind, scope_id, coverage, types, created_by, intro_video)
  values (btrim(p_title), p_scope_kind, p_scope_id, p_coverage, p_types, p_user_id, coalesce(p_intro_video, false))
  returning id;
$$;

-- READ: sets with their items, the claims they test (current revision) and one person's levels.
-- p_set_id null reads every set in the space (Start review mixes them).
create or replace function public.read_study_sets(p_user_id uuid, p_set_id uuid default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with sets as (
    select * from public.study_sets where p_set_id is null or id = p_set_id
  ), items as (
    select i.* from public.study_items i join sets s on s.id = i.set_id
  ), claims as (
    select distinct on (u.id) u.id unit_id, r.title, coalesce(r.content, '') content, u.retired_at is not null retired
    from items i join public.units u on u.id = i.unit_id left join public.revisions r on r.id = u.current_revision_id
  )
  select jsonb_build_object(
    'sets', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'title', s.title, 'scopeKind', s.scope_kind, 'scopeId', s.scope_id, 'coverage', s.coverage,
      'types', to_jsonb(s.types), 'introVideo', s.intro_video, 'createdAt', s.created_at) order by s.created_at desc) from sets s), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'setId', i.set_id, 'unitId', i.unit_id, 'revisionId', i.revision_id, 'kind', i.kind, 'prompt', i.prompt,
      'answer', i.answer, 'choices', i.choices, 'explanation', i.explanation, 'stale', i.stale) order by i.set_id, i.position, i.id) from items i), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(jsonb_build_object('unitId', c.unit_id, 'title', c.title, 'content', c.content, 'retired', c.retired)) from claims c), '[]'::jsonb),
    'progress', coalesce((select jsonb_agg(jsonb_build_object('unitId', p.unit_id, 'level', p.level, 'ease', p.ease, 'dueAt', p.due_at, 'lastSeenAt', p.last_seen_at))
      from public.study_progress p where p.user_id = p_user_id and p.unit_id in (select unit_id from claims)), '[]'::jsonb)
  );
$$;

alter function public.create_study_set(text, text, uuid, integer, text[], uuid, boolean) owner to space_runtime;
revoke execute on function public.create_study_set(text, text, uuid, integer, text[], uuid, boolean) from public, anon, authenticated;
grant execute on function public.create_study_set(text, text, uuid, integer, text[], uuid, boolean) to service_role, space_runtime;

revoke create on schema public from space_runtime;

notify pgrst, 'reload schema';
