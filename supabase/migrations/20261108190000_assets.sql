-- =====================================================================
-- ASSETS: every picture, video and sound clip the sources brought in
-- =====================================================================
-- An asset is either a source that IS media (an uploaded image or video)
-- or a picture embedded in a document (a Word figure, whose passages carry
-- location.figure). The bytes stay where ingestion put them (the 'sources'
-- bucket); an asset row only points at them, remembers the passages that
-- describe it (so its claims and source are one join away), and holds what
-- the Media analyst wrote for the Assets page: a title, a short description
-- and tags. sync_assets() finds new ones; the app describes and tags them.
-- =====================================================================

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  kind text not null check (kind in ('image', 'video', 'audio')),
  storage_path text not null,                    -- in the 'sources' bucket
  mime_type text not null,
  figure_number int,                             -- a picture inside a document; null: the source file itself
  passage_ids uuid[] not null default '{}',      -- the passages describing it, in order
  title text,
  description text,
  tags text[] not null default '{}',
  input_hash text,                               -- the passage text it was described from
  described_at timestamptz,
  model text,
  created_at timestamptz not null default now(),
  unique (source_id, storage_path)
);
comment on table public.assets is 'Media from sources (uploaded images and videos, figures inside documents), described and tagged by the AI.';
create index assets_source_idx on public.assets (source_id);
alter table public.assets enable row level security;
grant select on public.assets to authenticated;
grant all on public.assets to service_role;
create policy assets_read on public.assets for select to authenticated using (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = 'assets') then
    alter publication supabase_realtime add table public.assets;
  end if;
end $$;

-- FINDS NEW ASSETS (and refreshes which passages describe each). Returns how many were added.
create function public.sync_assets()
returns int language plpgsql security definer set search_path = '' as $$
declare
  added int;
begin
  create temp table media_found on commit drop as
    -- sources that are media themselves
    select s.id source_id,
      case when s.mime_type like 'image/%' then 'image' when s.mime_type like 'video/%' then 'video' else 'audio' end kind,
      s.storage_path, s.mime_type, null::int figure_number,
      coalesce((select array_agg(p.id order by p.position) from public.passages p where p.source_id = s.id), '{}') passage_ids
    from public.sources s
    where s.mime_type like 'image/%' or s.mime_type like 'video/%' or s.mime_type like 'audio/%'
    union all
    -- pictures inside documents, named by their passages
    select f.source_id, 'image', f.path,
      case lower(substring(f.path from '\.([a-z]+)$')) when 'png' then 'image/png' when 'gif' then 'image/gif' when 'webp' then 'image/webp' else 'image/jpeg' end,
      (substring((array_agg(f.text order by f.position))[1] from '^Figure (\d+):'))::int,
      array_agg(f.id order by f.position)
    from (select p.id, p.source_id, p.position, p.text, p.location->>'figure' path from public.passages p where p.location ? 'figure') f
    join public.sources s on s.id = f.source_id and s.mime_type not like 'image/%'
    group by f.source_id, f.path;

  -- Known assets follow their passages (a rerun can change them); new ones are added
  update public.assets a set passage_ids = n.passage_ids, figure_number = n.figure_number
  from media_found n
  where a.source_id = n.source_id and a.storage_path = n.storage_path
    and (a.passage_ids is distinct from n.passage_ids or a.figure_number is distinct from n.figure_number);
  insert into public.assets (source_id, kind, storage_path, mime_type, figure_number, passage_ids)
  select source_id, kind, storage_path, mime_type, figure_number, passage_ids from media_found
  on conflict (source_id, storage_path) do nothing;
  get diagnostics added = row_count;
  drop table media_found;
  return added;
end $$;
revoke all on function public.sync_assets() from public, anon, authenticated;
grant execute on function public.sync_assets() to service_role;

select public.sync_assets();

notify pgrst, 'reload schema';
