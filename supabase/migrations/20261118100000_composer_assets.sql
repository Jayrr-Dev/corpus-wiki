-- Generated illustrations are reusable library assets, never fabricated source evidence.
alter table public.assets alter column source_id drop not null;
alter table public.assets
  add column origin text not null default 'source' check (origin in ('source','generated')),
  add column generated_by text,
  add column generated_page_id uuid references public.pages(id) on delete set null,
  add column content_hash text unique,
  add constraint asset_origin_source check ((origin='source' and source_id is not null) or (origin='generated' and source_id is null));

create table public.generated_asset_content (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  svg text not null,
  original_caption text not null
);
alter table public.generated_asset_content enable row level security;
revoke all on public.generated_asset_content from anon,authenticated;

create function public.catalogue_composer_run(p_run_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r composer_runs; f jsonb; v_asset_id uuid; content_key text; section_title text; asset_tags text[];
begin
  select * into strict r from composer_runs where id=p_run_id;
  for f in select value from jsonb_array_elements(r.composition->'figures') loop
    content_key := encode(sha256(convert_to(f->>'svg','UTF8')),'hex');
    select p->>'section' into section_title from jsonb_array_elements(r.snapshot->'paragraphs') p where p->>'id'=f->>'after' limit 1;
    select coalesce(array_agg(word order by first_position),'{}') into asset_tags from (
      select t.word word,min(t.position) first_position
      from regexp_split_to_table(lower(coalesce(section_title,r.snapshot->>'title','')), '[^[:alnum:]]+') with ordinality t(word,position)
      where length(t.word)>=3 and t.word not in ('the','and','for','from','between','other','with')
      group by t.word order by min(t.position) limit 6
    ) tags;
    insert into assets(source_id,kind,storage_path,mime_type,title,description,tags,described_at,model,asset_type,origin,generated_by,generated_page_id,content_hash,created_at)
    values(null,'image','generated/composer/'||content_key||'.svg','image/svg+xml',left(coalesce(section_title,f->>'learningGoal'),180),f->>'caption',asset_tags,now(),r.model,
      case when f->>'alt' ilike '%bar chart%' then 'chart' else 'diagram' end,'generated','Composer',r.page_id,content_key,r.created_at)
    on conflict(content_hash) do nothing;
    select a.id into v_asset_id from assets a where a.content_hash=content_key;
    insert into generated_asset_content(asset_id,svg,original_caption) values(v_asset_id,f->>'svg',coalesce(f->>'caption','')) on conflict(asset_id) do nothing;
  end loop;
end $$;

create function public.catalogue_composer_trigger() returns trigger
language plpgsql security definer set search_path=public as $$
begin perform public.catalogue_composer_run(new.id); return new; end $$;
create trigger composer_assets_after_save after insert on public.composer_runs for each row execute function public.catalogue_composer_trigger();

create function public.read_generated_asset(p_asset_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('svg',c.svg,'caption',c.original_caption,'title',a.title) from generated_asset_content c join assets a on a.id=c.asset_id where a.id=p_asset_id and a.origin='generated';
$$;
revoke all on function public.catalogue_composer_run(uuid),public.catalogue_composer_trigger(),public.read_generated_asset(uuid) from public,anon,authenticated;
grant execute on function public.catalogue_composer_run(uuid),public.read_generated_asset(uuid) to service_role;

-- Include prior accepted versions, deduplicating unchanged figures carried into newer runs.
do $$ declare r record; begin for r in select id from composer_runs order by created_at loop perform public.catalogue_composer_run(r.id); end loop; end $$;
notify pgrst,'reload schema';

