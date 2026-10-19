-- Public readers see a deliberately small, versioned projection. No anonymous
-- SELECT policy is added to any workspace table. All indexes are B-tree.
create table public.space_publications (
  space_id uuid primary key references public.spaces(id),
  slug text not null unique default replace(gen_random_uuid()::text,'-',''),
  visibility text not null default 'private' check (visibility in ('private','unlisted','public')),
  title text not null check (length(btrim(title)) between 1 and 80),
  description text not null default '' check (length(description)<=500),
  publisher text not null default '' check (length(publisher)<=80),
  embed_enabled boolean not null default false,
  edition uuid not null default gen_random_uuid(),
  published_at timestamptz not null default now()
);
create index space_publications_discovery on public.space_publications(visibility,published_at desc);
create table public.published_wiki_pages (
  space_id uuid not null references public.space_publications(space_id),
  page_id uuid not null,
  slug text not null,
  title text not null,
  body jsonb not null,
  search_text text not null,
  fingerprint text not null,
  primary key(space_id,page_id),
  unique(space_id,slug),
  foreign key(space_id,page_id) references public.pages(space_id,id)
);
create table public.public_wiki_events (
  space_id uuid not null references public.space_publications(space_id),
  page_slug text not null,
  visitor_hash text not null,
  rate_hash text not null,
  surface text not null check(surface in ('site','embed')),
  channel text not null check(channel in ('direct','explore','embed')),
  kind text not null check(kind in ('view','engaged')),
  bucket timestamptz not null,
  created_at timestamptz not null default now(),
  primary key(space_id,visitor_hash,page_slug,surface,kind,bucket)
);
create index public_wiki_events_time on public.public_wiki_events(created_at);
create index public_wiki_events_owner on public.public_wiki_events(space_id,created_at);
create index public_wiki_events_rate on public.public_wiki_events(rate_hash,created_at);
alter table public.space_publications enable row level security;
alter table public.published_wiki_pages enable row level security;
alter table public.public_wiki_events enable row level security;
revoke all on public.space_publications,public.published_wiki_pages,public.public_wiki_events from public,anon,authenticated,space_runtime;

-- Explicit text-only snapshot. Private IDs, sources, evidence, histories,
-- settings, section queries and storage paths never enter the public projection.
create function public.wiki_publication_snapshot(p_page uuid,p_space uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('title',p.title,'slug',p.slug,'sections',coalesce((
    select jsonb_agg(jsonb_build_object('title',s.title,'lines',(
      select jsonb_agg(r.content order by l.position,l.id)
      from public.lines l join public.line_revisions r on r.id=l.current_revision_id and r.space_id=l.space_id
      where l.section_id=s.id and l.space_id=p_space and l.retired_at is null
    )) order by s.position,s.id)
    from public.sections s where s.page_id=p.id and s.space_id=p_space and s.retired_at is null
      and exists(select 1 from public.lines l where l.section_id=s.id and l.space_id=p_space and l.retired_at is null)
  ),'[]'::jsonb)) from public.pages p where p.id=p_page and p.space_id=p_space and p.retired_at is null
$$;
revoke all on function public.wiki_publication_snapshot(uuid,uuid) from public,anon,authenticated,space_runtime;

create function public.wiki_publication_editor() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sid uuid := public.current_space_id(); person uuid := public.space_management_person(); result jsonb; begin
  if not exists(select 1 from public.spaces where id=sid and owner_id=person and deleted_at is null) then
    raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  select jsonb_build_object('spaceId',s.id,'spaceName',s.name,'publication',(
    select jsonb_build_object('slug',x.slug,'visibility',x.visibility,'title',x.title,'description',x.description,'publisher',x.publisher,'embedEnabled',x.embed_enabled,'publishedAt',x.published_at)
    from public.space_publications x where x.space_id=sid
  ),'publishedPages',coalesce((select jsonb_agg(jsonb_build_object('slug',w.slug,'title',w.title) order by w.title,w.slug)
    from public.published_wiki_pages w where w.space_id=sid),'[]'::jsonb),
    'pages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'slug',p.slug,'title',p.title,
    'hasText',jsonb_array_length(public.wiki_publication_snapshot(p.id,sid)->'sections')>0,
    'selected',exists(select 1 from public.published_wiki_pages w where w.space_id=sid and w.page_id=p.id),
    'fingerprint',md5(public.wiki_publication_snapshot(p.id,sid)::text)) order by p.title,p.id)
    from public.pages p where p.space_id=sid and p.retired_at is null),'[]'::jsonb)) into result
  from public.spaces s where s.id=sid;
  return result;
end $$;

create function public.preview_wiki_publication(p_page uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sid uuid := public.current_space_id(); person uuid := public.space_management_person(); body jsonb; begin
  if not exists(select 1 from public.spaces where id=sid and owner_id=person and deleted_at is null) then
    raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  body := public.wiki_publication_snapshot(p_page,sid);
  if body is null then raise exception 'Page not found' using errcode='42501'; end if;
  return jsonb_build_object('body',body,'fingerprint',md5(body::text));
end $$;

create function public.publish_space_wiki(p_visibility text,p_title text,p_description text,p_publisher text,p_embed boolean,p_pages jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid := public.current_space_id(); person uuid := public.space_management_person(); x public.space_publications; p record; snapshot jsonb; begin
  -- Serialize publish/unpublish and space deletion. The entire edition changes atomically.
  perform 1 from public.spaces where id=sid and owner_id=person and deleted_at is null for update;
  if not found then raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  if p_visibility is null or p_visibility not in ('private','unlisted','public') then raise exception 'Choose a valid visibility'; end if;
  if p_visibility='private' then
    update public.space_publications set visibility='private',embed_enabled=false,edition=gen_random_uuid() where space_id=sid returning * into x;
    delete from public.published_wiki_pages where space_id=sid;
    return jsonb_build_object('slug',x.slug,'visibility','private');
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 80 or p_description is null or length(p_description)>500
    or p_publisher is null or length(p_publisher)>80 or p_embed is null then raise exception 'Check the publication details'; end if;
  if p_pages is null or jsonb_typeof(p_pages)<>'array' then raise exception 'Choose pages to publish'; end if;
  if jsonb_array_length(p_pages) not between 1 and 100 then raise exception 'Publish between 1 and 100 pages at a time'; end if;
  if (select count(distinct v->>'id') from jsonb_array_elements(p_pages) v)<>jsonb_array_length(p_pages) then raise exception 'Choose each page once'; end if;
  insert into public.space_publications(space_id,visibility,title,description,publisher,embed_enabled)
    values(sid,p_visibility,btrim(p_title),btrim(p_description),btrim(p_publisher),p_embed)
    on conflict(space_id) do update set visibility=excluded.visibility,title=excluded.title,description=excluded.description,
      publisher=excluded.publisher,embed_enabled=excluded.embed_enabled,edition=gen_random_uuid(),published_at=now()
    returning * into x;
  delete from public.published_wiki_pages where space_id=sid;
  for p in select * from jsonb_to_recordset(p_pages) as v(id uuid,fingerprint text) loop
    snapshot := public.wiki_publication_snapshot(p.id,sid);
    if snapshot is null then raise exception 'A selected page is unavailable or belongs to another space' using errcode='42501'; end if;
    if p.fingerprint is distinct from md5(snapshot::text) then raise exception 'A selected page changed. Refresh and preview it before publishing.'; end if;
    if jsonb_array_length(snapshot->'sections')=0 then raise exception 'A selected page has no article text to publish'; end if;
    if octet_length(snapshot::text)>1000000 then raise exception 'A selected page exceeds the 1 MB publication limit'; end if;
    insert into public.published_wiki_pages(space_id,page_id,slug,title,body,search_text,fingerprint)
      values(sid,p.id,snapshot->>'slug',snapshot->>'title',snapshot,
        (select coalesce(string_agg(t.value,' '),'') from jsonb_array_elements(snapshot->'sections') s,
          jsonb_array_elements_text(s->'lines') t),p.fingerprint);
  end loop;
  if (select sum(octet_length(body::text)) from public.published_wiki_pages where space_id=sid)>5000000 then raise exception 'This edition exceeds the 5 MB publication limit'; end if;
  return jsonb_build_object('slug',x.slug,'visibility',x.visibility);
end $$;

-- Anonymous access is by exact, random slug. Unlisted rows are never returned
-- by discovery, even for a signed-in visitor or an exact matching search term.
create function public.read_public_wiki(p_slug text,p_page text default null,p_embed boolean default false) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('slug',x.slug,'title',x.title,'description',x.description,'publisher',x.publisher,
    'visibility',x.visibility,'publishedAt',x.published_at,'edition',x.edition,'embedEnabled',x.embed_enabled,
    'pages',(select coalesce(jsonb_agg(jsonb_build_object('slug',w.slug,'title',w.title) order by w.title,w.slug),'[]'::jsonb)
      from public.published_wiki_pages w where w.space_id=x.space_id),
    'page',(select w.body from public.published_wiki_pages w where w.space_id=x.space_id and w.slug=p_page))
  from public.space_publications x join public.spaces s on s.id=x.space_id
  where x.slug=p_slug and x.visibility in ('public','unlisted') and s.deleted_at is null
    and (not p_embed or x.embed_enabled)
$$;

create function public.explore_public_wikis(p_query text default '',p_offset integer default 0) returns jsonb
language sql stable security definer set search_path='' as $$
  with matches as (
    select x.slug,x.title,x.description,x.publisher,x.published_at,
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

-- Only the same-origin server endpoint may record metrics. Tickets and hashes
-- are generated server-side. Repeated loads collapse to one view per 30 min.
create function public.record_public_wiki_event(p_slug text,p_page text,p_edition uuid,p_visitor text,p_rate text,p_surface text,p_channel text,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare x public.space_publications; person uuid; begin
  if p_kind is null or p_kind not in ('view','engaged') or p_surface is null or p_surface not in ('site','embed')
    or p_channel is null or p_channel not in ('direct','explore','embed') or p_visitor !~ '^[a-f0-9]{64}$' or p_rate !~ '^[a-f0-9]{64}$'
    or p_visitor is null or p_rate is null then raise exception 'Invalid event'; end if;
  select a.* into x from public.space_publications a join public.spaces s on s.id=a.space_id
    where a.slug=p_slug and a.edition=p_edition and a.visibility in ('public','unlisted') and s.deleted_at is null
    and (p_surface<>'embed' or a.embed_enabled);
  if x.space_id is null then return; end if;
  person := nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-person-id','')::uuid;
  if exists(select 1 from public.spaces where id=x.space_id and owner_id=person) then return; end if;
  if not exists(select 1 from public.published_wiki_pages where space_id=x.space_id and slug=p_page) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_rate,0));
  if (select count(*) from public.public_wiki_events where rate_hash=p_rate and created_at>now()-interval '1 minute')>=60 then return; end if;
  insert into public.public_wiki_events(space_id,page_slug,visitor_hash,rate_hash,surface,channel,kind,bucket)
    values(x.space_id,p_page,p_visitor,p_rate,p_surface,p_channel,p_kind,
      to_timestamp(floor(extract(epoch from now())/1800)*1800)) on conflict do nothing;
  -- Retention is bounded; the timestamp index keeps incremental cleanup cheap.
  delete from public.public_wiki_events where created_at<now()-interval '90 days';
end $$;

create function public.public_wiki_metrics(p_days integer default 30) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid := public.current_space_id(); person uuid := public.space_management_person(); result jsonb; begin
  if not exists(select 1 from public.spaces where id=sid and owner_id=person and deleted_at is null) then
    raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  if p_days is null or p_days not in (7,30,90) then raise exception 'Choose 7, 30 or 90 days'; end if;
  delete from public.public_wiki_events where space_id=sid and created_at<now()-interval '90 days';
  with events as (select * from public.public_wiki_events where space_id=sid and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'-(p_days-1)*interval '1 day')
  select jsonb_build_object('days',p_days,'views',count(*) filter(where kind='view'),
    'sessions',count(distinct visitor_hash) filter(where kind='view'),
    'embedViews',count(*) filter(where kind='view' and surface='embed'),
    'engagedReads',count(*) filter(where kind='engaged'),
    'exploreViews',count(*) filter(where kind='view' and channel='explore'),
    'topPages',coalesce((select jsonb_agg(to_jsonb(t)) from (
      select e.page_slug as slug,coalesce(w.title,'Previously published article') as title,count(*) as views
      from events e left join public.published_wiki_pages w on w.space_id=sid and w.slug=e.page_slug where e.kind='view'
      group by e.page_slug,w.title order by views desc,e.page_slug limit 10) t),'[]'::jsonb),
    'daily',coalesce((select jsonb_agg(to_jsonb(d) order by d.date) from (
      select (created_at at time zone 'UTC')::date as date,count(*) filter(where kind='view') as views,
        count(*) filter(where kind='view' and surface='embed') as embeds
      from events group by 1) d),'[]'::jsonb)) into result from events;
  return result;
end $$;

revoke all on function public.wiki_publication_editor(),public.preview_wiki_publication(uuid),public.publish_space_wiki(text,text,text,text,boolean,jsonb),
  public.public_wiki_metrics(integer),public.record_public_wiki_event(text,text,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.wiki_publication_editor(),public.preview_wiki_publication(uuid),public.publish_space_wiki(text,text,text,text,boolean,jsonb),
  public.public_wiki_metrics(integer),public.record_public_wiki_event(text,text,uuid,text,text,text,text,text) to service_role,space_runtime;
revoke all on function public.read_public_wiki(text,text,boolean),public.explore_public_wikis(text,integer) from public;
grant execute on function public.read_public_wiki(text,text,boolean),public.explore_public_wikis(text,integer) to anon,authenticated,service_role,space_runtime;
notify pgrst,'reload schema';
