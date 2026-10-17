alter table assets drop constraint assets_origin_check;
alter table assets drop constraint asset_origin_source;
alter table assets add constraint assets_origin_check check(origin in ('source','generated','external'));
alter table assets add constraint asset_origin_source check((origin='source' and source_id is not null) or (origin<>'source' and source_id is null));
alter table assets add column media_url text, add column attribution text, add column license text, add column entity_id uuid references entities(id) on delete set null;
create unique index asset_entity_logo on assets(entity_id) where entity_id is not null and asset_type='logo';

create function catalogue_stakeholder_logo() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.logo_url is not null then
    insert into assets(kind,storage_path,mime_type,title,description,tags,asset_type,origin,entity_id,media_url,attribution,license,described_at)
    select 'image',new.logo_url,'image/png',e.name||' logo','Official-site logo used on the stakeholder card for '||e.name,array['logo',lower(e.name)],'logo','external',e.id,new.logo_url,
      coalesce(new.web->>'website',new.logo_url),'Trademark; used for identification. No general reuse license asserted.',now()
    from entities e where e.id=new.entity_id
    on conflict(entity_id) where entity_id is not null and asset_type='logo' do update set media_url=excluded.media_url,storage_path=excluded.storage_path;
  end if;
  return new;
end $$;
revoke all on function catalogue_stakeholder_logo() from public,anon,authenticated;
create trigger stakeholder_logo_asset after insert or update of logo_url on entity_profiles for each row execute function catalogue_stakeholder_logo();
update entity_profiles set logo_url=logo_url where logo_url is not null;

create function composer_asset_library() returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description,'type',asset_type,'tags',tags,'origin',origin,'attribution',attribution,'license',license,'entityId',entity_id)), '[]')
  from (select * from assets where deleted_at is null and kind='image' and title is not null order by created_at desc limit 200) a;
$$;
revoke all on function composer_asset_library() from public,anon,authenticated;
grant execute on function composer_asset_library() to service_role;

-- Reused assets retain their own provenance; they are not re-catalogued as generated SVGs.
do $$ declare definition text; begin
  select pg_get_functiondef('public.catalogue_composer_run(uuid)'::regprocedure) into definition;
  definition := replace(definition, 'content_key :=', E'if f->>''assetId'' is not null then continue; end if;\n    content_key :=');
  execute definition;
  select pg_get_functiondef('public.save_composer_run(uuid,jsonb,jsonb,jsonb,text)'::regprocedure) into definition;
  definition := replace(definition, 'or length(coalesce(f->>''svg'','''')) not between 1 and 30000', 'or (case when f->>''assetId'' is not null then not exists(select 1 from assets a where a.id::text=f->>''assetId'' and a.deleted_at is null and a.kind=''image'') else length(coalesce(f->>''svg'','''')) not between 1 and 30000 end)');
  execute definition;
end $$;
notify pgrst,'reload schema';
