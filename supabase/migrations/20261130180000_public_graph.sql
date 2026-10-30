-- A person may publish a graph of a wiki's pages and the claims behind them. Off by
-- default. Like the page text it is a snapshot made at publish, so later workspace
-- changes stay private until the next publish, and every publish rewrites it.
-- Only claims stated by a published line are included. Entities, stakeholders, sources,
-- passages and suggestions never enter it, and rows get short keys, never real ids.
-- A claim's label is its stored title, or else the published line that states it, so
-- the full claim text stays out. publishGraph tells the app all of this is in place.
-- Runs after 20261130170000.
alter table public.space_publications
  add column include_graph boolean not null default false,
  add column graph jsonb;

create function public.wiki_publication_graph(p_space uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with published as (
    select w.page_id,p.domain_id,w.slug,w.title,'p'||row_number() over(order by w.title,w.slug) as key
    from public.published_wiki_pages w join public.pages p on p.id=w.page_id and p.space_id=p_space
    where w.space_id=p_space
  ), placed as (
    select distinct on (v.unit_id,g.key,s.id) v.unit_id,g.key as page,
      coalesce(nullif(btrim(s.title),''),'Untitled') as section,s.position,
      coalesce(nullif(btrim(v.title),''),left(regexp_replace(btrim(r.content),'\s+',' ','g'),60)) as label
    from published g
    join public.sections s on s.page_id=g.page_id and s.space_id=p_space and s.retired_at is null
    join public.lines l on l.section_id=s.id and l.space_id=p_space and l.retired_at is null
    join public.line_revisions r on r.id=l.current_revision_id and r.space_id=l.space_id
    join public.revisions v on v.id=any(r.unit_revision_ids)
    join public.units u on u.id=v.unit_id and u.space_id=p_space and u.retired_at is null
    order by v.unit_id,g.key,s.id,l.position,l.id
  ), claims as (
    select c.unit_id,'c'||row_number() over(order by c.unit_id) as key from (
      select distinct unit_id from placed order by unit_id limit 3000) c
  ) select jsonb_build_object(
    'pages',coalesce((select jsonb_agg(jsonb_build_object('id',g.key,'slug',g.slug,'title',g.title,
      'domains',(select coalesce(jsonb_agg(d.path),'[]'::jsonb) from public.domains d where d.id=g.domain_id and d.space_id=p_space))
      order by g.title,g.slug) from published g),'[]'::jsonb),
    'claims',coalesce((select jsonb_agg(jsonb_build_object('id',c.key,
      'label',(select x.label from placed x where x.unit_id=c.unit_id order by x.page,x.position limit 1),
      'domains',(select coalesce(jsonb_agg(d.path order by d.path),'[]'::jsonb) from public.unit_domains m
        join public.domains d on d.id=m.domain_id and d.space_id=p_space where m.unit_id=c.unit_id),
      'pages',(select jsonb_agg(jsonb_build_object('page',x.page,'section',x.section,'position',x.position) order by x.page,x.position)
        from placed x where x.unit_id=c.unit_id)) order by c.key) from claims c),'[]'::jsonb),
    'links',coalesce((select jsonb_agg(jsonb_build_object('id','l'||l.n,'source',l.source,'target',l.target,'kind',l.kind) order by l.n) from (
      select a.key as source,b.key as target,x.type as kind,row_number() over(order by a.key,b.key,x.type) as n
      from public.relationships x join claims a on a.unit_id=x.from_unit_id join claims b on b.unit_id=x.to_unit_id
      where x.retired_at is null) l),'[]'::jsonb))
$$;
revoke all on function public.wiki_publication_graph(uuid) from public,anon,authenticated,space_runtime;

create or replace function public.wiki_publication_editor() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sid uuid := public.current_space_id(); person uuid := public.space_management_person(); result jsonb; begin
  if not exists(select 1 from public.spaces where id=sid and owner_id=person and deleted_at is null) then
    raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  select jsonb_build_object('spaceId',s.id,'spaceName',s.name,'publishChoices',true,'publishGraph',true,'publication',(
    select jsonb_build_object('slug',x.slug,'visibility',x.visibility,'title',x.title,'description',x.description,'publisher',x.publisher,'embedEnabled',x.embed_enabled,'includeSources',x.include_sources,'includeGraph',x.include_graph,'hasGraph',x.graph is not null,'publishedAt',x.published_at)
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

drop function public.publish_space_wiki(text,text,text,text,boolean,jsonb,boolean);
create function public.publish_space_wiki(p_visibility text,p_title text,p_description text,p_publisher text,p_embed boolean,p_pages jsonb,p_sources boolean default false,p_graph boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid := public.current_space_id(); person uuid := public.space_management_person(); x public.space_publications; p record; snapshot jsonb; shape jsonb; begin
  -- Serialize publish/unpublish and space deletion. The entire edition changes atomically.
  perform 1 from public.spaces where id=sid and owner_id=person and deleted_at is null for update;
  if not found then raise exception 'Space not found or not owned by you' using errcode='42501'; end if;
  if p_visibility is null or p_visibility not in ('private','unlisted','public') then raise exception 'Choose a valid visibility'; end if;
  if p_visibility='private' then
    update public.space_publications set visibility='private',embed_enabled=false,include_sources=false,include_graph=false,graph=null,edition=gen_random_uuid() where space_id=sid returning * into x;
    delete from public.published_wiki_pages where space_id=sid;
    return jsonb_build_object('slug',x.slug,'visibility','private');
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 80 or p_description is null or length(p_description)>500
    or p_publisher is null or length(p_publisher)>80 or p_embed is null or p_sources is null or p_graph is null then raise exception 'Check the publication details'; end if;
  if p_pages is null or jsonb_typeof(p_pages)<>'array' then raise exception 'Choose pages to publish'; end if;
  if jsonb_array_length(p_pages) not between 1 and 100 then raise exception 'Publish between 1 and 100 pages at a time'; end if;
  if (select count(distinct v->>'id') from jsonb_array_elements(p_pages) v)<>jsonb_array_length(p_pages) then raise exception 'Choose each page once'; end if;
  insert into public.space_publications(space_id,visibility,title,description,publisher,embed_enabled,include_sources,include_graph)
    values(sid,p_visibility,btrim(p_title),btrim(p_description),btrim(p_publisher),p_embed,p_sources,p_graph)
    on conflict(space_id) do update set visibility=excluded.visibility,title=excluded.title,description=excluded.description,
      publisher=excluded.publisher,embed_enabled=excluded.embed_enabled,include_sources=excluded.include_sources,include_graph=excluded.include_graph,graph=null,edition=gen_random_uuid(),published_at=now()
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
  if p_graph then
    shape := public.wiki_publication_graph(sid);
    if octet_length(shape::text)>3000000 then raise exception 'This graph exceeds the 3 MB publication limit. Turn off Include graph.'; end if;
    update public.space_publications set graph=shape where space_id=sid;
  end if;
  return jsonb_build_object('slug',x.slug,'visibility',x.visibility);
end $$;
revoke all on function public.publish_space_wiki(text,text,text,text,boolean,jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.publish_space_wiki(text,text,text,text,boolean,jsonb,boolean,boolean) to service_role,space_runtime;

create or replace function public.read_public_wiki(p_slug text,p_page text default null,p_embed boolean default false) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('slug',x.slug,'title',x.title,'description',x.description,'publisher',x.publisher,
    'visibility',x.visibility,'publishedAt',x.published_at,'edition',x.edition,'embedEnabled',x.embed_enabled,'hasGraph',x.graph is not null,
    'pages',(select coalesce(jsonb_agg(jsonb_build_object('slug',w.slug,'title',w.title) order by w.title,w.slug),'[]'::jsonb)
      from public.published_wiki_pages w where w.space_id=x.space_id),
    'page',(select w.body from public.published_wiki_pages w where w.space_id=x.space_id and w.slug=p_page))
  from public.space_publications x join public.spaces s on s.id=x.space_id
  where x.slug=p_slug and x.visibility in ('public','unlisted') and s.deleted_at is null
    and (not p_embed or x.embed_enabled)
$$;

create function public.read_public_graph(p_slug text) returns jsonb
language sql stable security definer set search_path='' as $$
  select x.graph from public.space_publications x join public.spaces s on s.id=x.space_id
  where x.slug=p_slug and x.visibility in ('public','unlisted') and s.deleted_at is null
$$;
revoke all on function public.read_public_graph(text) from public;
grant execute on function public.read_public_graph(text) to anon,authenticated,service_role,space_runtime;
notify pgrst,'reload schema';
