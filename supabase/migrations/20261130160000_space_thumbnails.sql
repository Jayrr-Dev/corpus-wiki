-- A published Space may carry one thumbnail. It is a resized copy in its own
-- private bucket, so a private asset never becomes public by reference, and the
-- only way to reach it is public_wiki_thumbnail, which stops answering the moment
-- the Space is unpublished or deleted. The path holds the random publication slug,
-- never a Space id, and readers only ever see a short version of it.
do $$ begin
if to_regclass('storage.buckets') is not null then
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('space-thumbnails','space-thumbnails',false,2097152,array['image/webp'])
on conflict(id) do nothing;
end if;
end $$;

-- thumbnail_auto: true until a person decides, so a later publish may pick one for them.
-- Removing a thumbnail sets it false, so the choice to have none is kept.
alter table public.space_publications
  add column thumbnail_path text check (thumbnail_path ~ '^[a-f0-9]{32}/[a-f0-9]{64}\.webp$'),
  add column thumbnail_auto boolean not null default true;

create or replace function public.explore_public_wikis(p_query text default '',p_offset integer default 0) returns jsonb
language sql stable security definer set search_path='' as $$
  with matches as (
    select x.slug,x.title,x.description,x.publisher,x.published_at,left(md5(x.thumbnail_path),12) as thumbnail_version,
      (select count(*) from public.published_wiki_pages w where w.space_id=x.space_id) as page_count,
      (select coalesce(jsonb_agg(jsonb_build_object('slug',w.slug,'title',w.title) order by w.title),'[]'::jsonb)
       from (select w.slug,w.title from public.published_wiki_pages w where w.space_id=x.space_id and length(btrim(left(coalesce(p_query,''),120)))>0
         and (strpos(lower(w.title),lower(btrim(left(p_query,120))))>0 or strpos(lower(w.search_text),lower(btrim(left(p_query,120))))>0)
         order by w.title,w.slug limit 3) w) as matching_pages
    from public.space_publications x join public.spaces s on s.id=x.space_id
    where x.visibility='public' and s.deleted_at is null and (
      btrim(coalesce(p_query,''))='' or strpos(lower(x.title||' '||x.description||' '||x.publisher),lower(btrim(left(p_query,120))))>0
      or exists(select 1 from public.published_wiki_pages w where w.space_id=x.space_id
        and strpos(lower(w.title||' '||w.search_text),lower(btrim(left(p_query,120))))>0))
  ) select jsonb_build_object('total',(select count(*) from matches),'spaces',coalesce((
    select jsonb_agg(to_jsonb(m) order by m.published_at desc,m.slug) from (
      select * from matches order by published_at desc,slug limit 20 offset greatest(0,least(coalesce(p_offset,0),10000))
    ) m),'[]'::jsonb))
$$;

create function public.public_wiki_thumbnail(p_slug text) returns text
language sql stable security definer set search_path='' as $$
  select x.thumbnail_path from public.space_publications x join public.spaces s on s.id=x.space_id
  where x.slug=p_slug and x.visibility in ('public','unlisted') and s.deleted_at is null
$$;

create function public.space_thumbnail_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sid uuid := public.current_space_id(); person uuid := public.space_management_person(); result jsonb; begin
  if not exists(select 1 from public.spaces where id=sid and owner_id=person and deleted_at is null) then
    raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  select jsonb_build_object('slug',x.slug,'path',x.thumbnail_path,'version',left(md5(x.thumbnail_path),12),'auto',x.thumbnail_auto) into result
    from public.space_publications x where x.space_id=sid;
  return result;
end $$;

-- Returns the path it replaced, so the caller can remove that file.
create function public.set_space_thumbnail(p_path text,p_auto boolean) returns text
language plpgsql security definer set search_path='' as $$
declare sid uuid := public.current_space_id(); person uuid := public.space_management_person(); x public.space_publications; previous text; begin
  perform 1 from public.spaces where id=sid and owner_id=person and deleted_at is null for update;
  if not found then raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  if p_auto is null then raise exception 'Say whether this thumbnail was picked automatically'; end if;
  select * into x from public.space_publications where space_id=sid for update;
  if x.space_id is null or x.visibility='private' then raise exception 'Publish this space before setting a thumbnail'; end if;
  if p_path is not null and split_part(p_path,'/',1)<>x.slug then raise exception 'That thumbnail belongs to another space' using errcode='42501'; end if;
  previous := x.thumbnail_path;
  update public.space_publications set thumbnail_path=p_path,thumbnail_auto=p_auto where space_id=sid;
  return previous;
end $$;

revoke all on function public.space_thumbnail_state(),public.set_space_thumbnail(text,boolean) from public,anon,authenticated;
grant execute on function public.space_thumbnail_state(),public.set_space_thumbnail(text,boolean) to service_role,space_runtime;
revoke all on function public.public_wiki_thumbnail(text) from public;
grant execute on function public.public_wiki_thumbnail(text) to anon,authenticated,service_role,space_runtime;
notify pgrst,'reload schema';
