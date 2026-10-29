-- =====================================================================
-- SECOND BRAIN · VIDEO
-- =====================================================================
-- Narrated videos made from a topic or article (docs/knowledge-modules-plan.md,
-- section 3). One row per video; the scenes, their audio paths and character
-- timings live in `script`. A video moves script → voicing → rendering → ready,
-- or to failed from voicing or rendering (lib/video/status.ts holds the rules;
-- update_video only applies a change while the row is still in the expected
-- status, so two writers can never both move it).
-- 1. TABLE     public.videos, readable in the space, written by the server
-- 2. FUNCTIONS create_video, list_videos, get_video, update_video
-- 3. STORAGE   the private `videos` bucket: scene audio, the composition,
--              the MP4 and its poster, under <space>/<video>/
-- =====================================================================


-- =====================================================================
-- 1. TABLE
-- =====================================================================

grant create on schema public to space_runtime;

create table public.videos (
  id uuid not null default gen_random_uuid(),
  space_id uuid not null default public.current_space_id() references public.spaces (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  scope_kind text not null check (scope_kind in ('topic', 'article', 'entity', 'glossary')),
  scope_id uuid,
  coverage smallint not null check (coverage in (25, 50, 100)),
  length text not null check (length in ('short', 'medium', 'long')),
  voice_id text not null check (length(voice_id) between 1 and 100),
  status text not null default 'script' check (status in ('script', 'voicing', 'rendering', 'ready', 'failed')),
  script jsonb not null default '{"scenes": []}'::jsonb check (jsonb_typeof(script) = 'object'),
  duration_ms integer check (duration_ms >= 0),
  video_path text,
  poster_path text,
  render_job_id text,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  -- when the status last changed: the timeout check measures voicing and rendering from here
  status_changed_at timestamptz not null default now(),
  primary key (space_id, id),
  unique (id),
  check ((scope_kind = 'glossary') = (scope_id is null)),
  check (status <> 'ready' or video_path is not null)
);
comment on table public.videos is 'Narrated videos (Video module): the script, voicing and render state of each.';
create index videos_list_idx on public.videos (space_id, created_at desc);
alter table public.videos enable row level security;
alter table public.videos force row level security;
create policy space_server on public.videos for all to space_runtime
  using (space_id = (select public.current_space_id())) with check (space_id = (select public.current_space_id()));
create policy space_browser_boundary on public.videos for select to authenticated
  using (space_id = any (array(select unnest(public.readable_space_ids()))));
grant select on public.videos to authenticated;
grant select, insert, update, delete on public.videos to space_runtime;


-- =====================================================================
-- 2. FUNCTIONS
-- =====================================================================

-- One video as the app reads it (lib/video/types.ts → VideoRow)
create function public.video_json(v public.videos)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', v.id, 'title', v.title, 'scopeKind', v.scope_kind, 'scopeId', v.scope_id,
    'coverage', v.coverage, 'length', v.length, 'voiceId', v.voice_id, 'status', v.status,
    'script', v.script, 'durationMs', v.duration_ms, 'videoPath', v.video_path,
    'posterPath', v.poster_path, 'renderJobId', v.render_job_id, 'error', v.error,
    'createdBy', v.created_by, 'createdAt', v.created_at, 'statusChangedAt', v.status_changed_at);
$$;

-- WRITE: a new video in status script, with the Narrator's scenes
create function public.create_video(p_video jsonb)
returns jsonb language sql set search_path = '' as $$
  insert into public.videos (title, scope_kind, scope_id, coverage, length, voice_id, script, created_by)
  values (p_video ->> 'title', p_video ->> 'scopeKind', (p_video ->> 'scopeId')::uuid, (p_video ->> 'coverage')::smallint,
          p_video ->> 'length', p_video ->> 'voiceId', coalesce(p_video -> 'script', '{"scenes": []}'::jsonb), (p_video ->> 'createdBy')::uuid)
  returning public.video_json(videos);
$$;

-- READ: every video in the space, newest first
create function public.list_videos()
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(public.video_json(v) order by v.created_at desc, v.id), '[]'::jsonb)
  from public.videos v
  where v.space_id = public.current_space_id();
$$;

-- READ: one video, or null
create function public.get_video(p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select public.video_json(v) from public.videos v where v.id = p_id and v.space_id = public.current_space_id();
$$;

-- WRITE: applies a patch only while the video is in one of p_from (compare and set).
-- Returns the updated video, or null when it had moved on (or does not exist).
create function public.update_video(p_id uuid, p_from text[], p_patch jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  result jsonb;
  extra text[];
begin
  select array_agg(k) into extra from jsonb_object_keys(p_patch) k
  where k not in ('title', 'status', 'script', 'durationMs', 'videoPath', 'posterPath', 'renderJobId', 'error', 'voiceId');
  if extra is not null then
    raise exception 'Unknown video fields: %', array_to_string(extra, ', ') using errcode = '22023';
  end if;
  update public.videos v set
    title = case when p_patch ? 'title' then p_patch ->> 'title' else v.title end,
    status = case when p_patch ? 'status' then p_patch ->> 'status' else v.status end,
    script = case when p_patch ? 'script' then p_patch -> 'script' else v.script end,
    duration_ms = case when p_patch ? 'durationMs' then (p_patch ->> 'durationMs')::integer else v.duration_ms end,
    video_path = case when p_patch ? 'videoPath' then p_patch ->> 'videoPath' else v.video_path end,
    poster_path = case when p_patch ? 'posterPath' then p_patch ->> 'posterPath' else v.poster_path end,
    render_job_id = case when p_patch ? 'renderJobId' then p_patch ->> 'renderJobId' else v.render_job_id end,
    error = case when p_patch ? 'error' then p_patch ->> 'error' else v.error end,
    voice_id = case when p_patch ? 'voiceId' then p_patch ->> 'voiceId' else v.voice_id end,
    status_changed_at = case when p_patch ? 'status' and p_patch ->> 'status' is distinct from v.status then now() else v.status_changed_at end
  where v.id = p_id and v.space_id = public.current_space_id() and v.status = any (p_from)
  returning public.video_json(v) into result;
  return result;
end $$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    'public.video_json(public.videos)'::regprocedure, 'public.create_video(jsonb)'::regprocedure,
    'public.list_videos()'::regprocedure, 'public.get_video(uuid)'::regprocedure,
    'public.update_video(uuid,text[],jsonb)'::regprocedure] loop
    execute format('alter function %s owner to space_runtime', signature);
    execute format('revoke execute on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to service_role, space_runtime', signature);
  end loop;
end $$;

revoke create on schema public from space_runtime;


-- =====================================================================
-- 3. STORAGE
-- =====================================================================

do $$ begin
if to_regclass('storage.buckets') is not null then
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, 524288000, array['audio/mpeg', 'text/html', 'application/json', 'video/mp4', 'image/jpeg'])
on conflict (id) do nothing;
end if;
end $$;

notify pgrst, 'reload schema';
