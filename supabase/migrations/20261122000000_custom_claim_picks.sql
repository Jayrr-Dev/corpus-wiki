-- =====================================================================
-- CUSTOM CLAIM PICKS: a study set or a video can keep the claims its
-- person checked by hand (Coverage: Custom). claim_ids is null for a
-- share of the source (coverage 25, 50 or 100). When it is set, coverage
-- is stored as 100 and claim_ids holds the checked claims (units.id).
-- Doc sets do not save picks yet (their picker has no Custom option).
-- =====================================================================

alter table public.study_sets add column claim_ids uuid[];
alter table public.videos add column claim_ids uuid[];

-- space_runtime owns the study functions; it needs CREATE on the schema for the owner change
grant create on schema public to space_runtime;

-- WRITE: a new, empty set; its questions follow in batches (add_study_items)
drop function public.create_study_set(text, text, uuid, integer, text[], uuid, boolean);
create function public.create_study_set(p_title text, p_scope_kind text, p_scope_id uuid, p_coverage integer, p_types text[], p_user_id uuid, p_intro_video boolean default false, p_claim_ids uuid[] default null)
returns uuid
language sql
set search_path = ''
as $$
  insert into public.study_sets (title, scope_kind, scope_id, coverage, types, created_by, intro_video, claim_ids)
  values (btrim(p_title), p_scope_kind, p_scope_id, p_coverage, p_types, p_user_id, coalesce(p_intro_video, false), p_claim_ids)
  returning id;
$$;

-- READ: sets with their items, the claims they test (current revision) and one person's levels.
-- A set reports `custom` when its claims were checked by hand.
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
      'custom', s.claim_ids is not null,
      'types', to_jsonb(s.types), 'introVideo', s.intro_video, 'createdAt', s.created_at) order by s.created_at desc) from sets s), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'setId', i.set_id, 'unitId', i.unit_id, 'revisionId', i.revision_id, 'kind', i.kind, 'prompt', i.prompt,
      'answer', i.answer, 'choices', i.choices, 'explanation', i.explanation, 'stale', i.stale) order by i.set_id, i.position, i.id) from items i), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(jsonb_build_object('unitId', c.unit_id, 'title', c.title, 'content', c.content, 'retired', c.retired)) from claims c), '[]'::jsonb),
    'progress', coalesce((select jsonb_agg(jsonb_build_object('unitId', p.unit_id, 'level', p.level, 'ease', p.ease, 'dueAt', p.due_at, 'lastSeenAt', p.last_seen_at))
      from public.study_progress p where p.user_id = p_user_id and p.unit_id in (select unit_id from claims)), '[]'::jsonb)
  );
$$;

alter function public.create_study_set(text, text, uuid, integer, text[], uuid, boolean, uuid[]) owner to space_runtime;
revoke execute on function public.create_study_set(text, text, uuid, integer, text[], uuid, boolean, uuid[]) from public, anon, authenticated;
grant execute on function public.create_study_set(text, text, uuid, integer, text[], uuid, boolean, uuid[]) to service_role, space_runtime;

revoke create on schema public from space_runtime;

-- VIDEO: one video as the app reads it, now with its checked claims (null for a share)
create or replace function public.video_json(v public.videos)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', v.id, 'title', v.title, 'scopeKind', v.scope_kind, 'scopeId', v.scope_id,
    'coverage', v.coverage, 'claimIds', to_jsonb(v.claim_ids), 'length', v.length, 'voiceId', v.voice_id, 'status', v.status,
    'script', v.script, 'durationMs', v.duration_ms, 'videoPath', v.video_path,
    'posterPath', v.poster_path, 'renderJobId', v.render_job_id, 'error', v.error,
    'createdBy', v.created_by, 'createdAt', v.created_at, 'statusChangedAt', v.status_changed_at);
$$;

-- WRITE: a new video in status script. p_video.claimIds, when sent, are the checked claims.
create or replace function public.create_video(p_video jsonb)
returns jsonb language sql set search_path = '' as $$
  insert into public.videos (title, scope_kind, scope_id, coverage, length, voice_id, script, created_by, claim_ids)
  values (p_video ->> 'title', p_video ->> 'scopeKind', (p_video ->> 'scopeId')::uuid, (p_video ->> 'coverage')::smallint,
          p_video ->> 'length', p_video ->> 'voiceId', coalesce(p_video -> 'script', '{"scenes": []}'::jsonb), (p_video ->> 'createdBy')::uuid,
          case when jsonb_typeof(p_video -> 'claimIds') = 'array'
            then array(select value::uuid from jsonb_array_elements_text(p_video -> 'claimIds') as value) end)
  returning public.video_json(videos);
$$;

notify pgrst, 'reload schema';
