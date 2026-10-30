-- A person may publish a wiki with its sources listed. Off by default. The list is
-- stored inside each page's published body, so with the choice off there is nothing
-- to leak: read_public_wiki returns that body and needs no change, and every publish
-- rewrites every page. Only a source's name and its web link are ever copied, never
-- a file, passage, quote or id. Archived sources and non-web links are left out.
-- The fingerprint stays over the article text, so pages reviewed earlier stay valid.
-- Runs after 20261130160000; publishChoices tells the app both are in place.
alter table public.space_publications
  add column include_sources boolean not null default false;

create function public.wiki_publication_sources(p_page uuid,p_space uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('title',c.title,'url',c.url) order by lower(c.title),c.title,c.url),'[]'::jsonb)
  from (
    select distinct left(btrim(o.title),300) as title,
      -- A web link with no credentials in it. Anything else stays out of the page.
      case when length(o.url)<=2000 and o.url ~* '^https?://[^/?#@]+([/?#]|$)' then o.url end as url
    from public.sections s
    join public.lines l on l.section_id=s.id and l.space_id=p_space and l.retired_at is null
    join public.line_revisions r on r.id=l.current_revision_id and r.space_id=l.space_id
    join public.revisions v on v.id=any(r.unit_revision_ids)
    join public.passages q on q.id=any(v.passage_ids)
    join public.sources o on o.id=q.source_id and o.space_id=p_space and o.archived_at is null
    where s.page_id=p_page and s.space_id=p_space and s.retired_at is null and length(btrim(o.title))>0
    order by 1,2 limit 200
  ) c
$$;
revoke all on function public.wiki_publication_sources(uuid,uuid) from public,anon,authenticated,space_runtime;

create or replace function public.wiki_publication_editor() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sid uuid := public.current_space_id(); person uuid := public.space_management_person(); result jsonb; begin
  if not exists(select 1 from public.spaces where id=sid and owner_id=person and deleted_at is null) then
    raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  select jsonb_build_object('spaceId',s.id,'spaceName',s.name,'publishChoices',true,'publication',(
    select jsonb_build_object('slug',x.slug,'visibility',x.visibility,'title',x.title,'description',x.description,'publisher',x.publisher,'embedEnabled',x.embed_enabled,'includeSources',x.include_sources,'publishedAt',x.published_at)
    from public.space_publications x where x.space_id=sid
  ),'publishedPages',coalesce((select jsonb_agg(jsonb_build_object('slug',w.slug,'title',w.title) order by w.title,w.slug)
    from public.published_wiki_pages w where w.space_id=sid),'[]'::jsonb),
    'pages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'slug',p.slug,'title',p.title,
    'hasText',jsonb_array_length(public.wiki_publication_snapshot(p.id,sid)->'sections')>0,
    'selected',exists(select 1 from public.published_wiki_pages w where w.space_id=sid and w.page_id=p.id),
    'fingerprint',md5(public.wiki_publication_snapshot(p.id,sid)::text)) order by p.title,p.id)
    from public.pages p where p.space_id=sid and p.retired_at is null and p.kind = 'article'),'[]'::jsonb)) into result
  from public.spaces s where s.id=sid;
  return result;
end $$;

create or replace function public.preview_wiki_publication(p_page uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sid uuid := public.current_space_id(); person uuid := public.space_management_person(); body jsonb; begin
  if not exists(select 1 from public.spaces where id=sid and owner_id=person and deleted_at is null) then
    raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  body := public.wiki_publication_snapshot(p_page,sid);
  if body is null then raise exception 'Page not found' using errcode='42501'; end if;
  return jsonb_build_object('body',body,'fingerprint',md5(body::text),'sources',public.wiki_publication_sources(p_page,sid));
end $$;

drop function public.publish_space_wiki(text,text,text,text,boolean,jsonb);
create function public.publish_space_wiki(p_visibility text,p_title text,p_description text,p_publisher text,p_embed boolean,p_pages jsonb,p_sources boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid := public.current_space_id(); person uuid := public.space_management_person(); x public.space_publications; p record; snapshot jsonb; begin
  -- Serialize publish/unpublish and space deletion. The entire edition changes atomically.
  perform 1 from public.spaces where id=sid and owner_id=person and deleted_at is null for update;
  if not found then raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  if p_visibility is null or p_visibility not in ('private','unlisted','public') then raise exception 'Choose a valid visibility'; end if;
  if p_visibility='private' then
    update public.space_publications set visibility='private',embed_enabled=false,include_sources=false,edition=gen_random_uuid() where space_id=sid returning * into x;
    delete from public.published_wiki_pages where space_id=sid;
    return jsonb_build_object('slug',x.slug,'visibility','private');
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 80 or p_description is null or length(p_description)>500
    or p_publisher is null or length(p_publisher)>80 or p_embed is null or p_sources is null then raise exception 'Check the publication details'; end if;
  if p_pages is null or jsonb_typeof(p_pages)<>'array' then raise exception 'Choose pages to publish'; end if;
  if jsonb_array_length(p_pages) not between 1 and 100 then raise exception 'Publish between 1 and 100 pages at a time'; end if;
  if (select count(distinct v->>'id') from jsonb_array_elements(p_pages) v)<>jsonb_array_length(p_pages) then raise exception 'Choose each page once'; end if;
  insert into public.space_publications(space_id,visibility,title,description,publisher,embed_enabled,include_sources)
    values(sid,p_visibility,btrim(p_title),btrim(p_description),btrim(p_publisher),p_embed,p_sources)
    on conflict(space_id) do update set visibility=excluded.visibility,title=excluded.title,description=excluded.description,
      publisher=excluded.publisher,embed_enabled=excluded.embed_enabled,include_sources=excluded.include_sources,edition=gen_random_uuid(),published_at=now()
    returning * into x;
  delete from public.published_wiki_pages where space_id=sid;
  for p in select * from jsonb_to_recordset(p_pages) as v(id uuid,fingerprint text) loop
    snapshot := public.wiki_publication_snapshot(p.id,sid);
    if snapshot is null then raise exception 'A selected page is unavailable or belongs to another space' using errcode='42501'; end if;
    if p.fingerprint is distinct from md5(snapshot::text) then raise exception 'A selected page changed. Refresh and preview it before publishing.'; end if;
    if jsonb_array_length(snapshot->'sections')=0 then raise exception 'A selected page has no article text to publish'; end if;
    if octet_length(snapshot::text)>1000000 then raise exception 'A selected page exceeds the 1 MB publication limit'; end if;
    insert into public.published_wiki_pages(space_id,page_id,slug,title,body,search_text,fingerprint)
      values(sid,p.id,snapshot->>'slug',snapshot->>'title',
        case when p_sources then snapshot||jsonb_build_object('sources',public.wiki_publication_sources(p.id,sid)) else snapshot end,
        (select coalesce(string_agg(t.value,' '),'') from jsonb_array_elements(snapshot->'sections') s,
          jsonb_array_elements_text(s->'lines') t),p.fingerprint);
  end loop;
  if (select sum(octet_length(body::text)) from public.published_wiki_pages where space_id=sid)>5000000 then raise exception 'This edition exceeds the 5 MB publication limit'; end if;
  return jsonb_build_object('slug',x.slug,'visibility',x.visibility);
end $$;
revoke all on function public.publish_space_wiki(text,text,text,text,boolean,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.publish_space_wiki(text,text,text,text,boolean,jsonb,boolean) to service_role,space_runtime;
notify pgrst,'reload schema';
