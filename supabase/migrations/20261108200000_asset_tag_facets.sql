-- =====================================================================
-- ASSET TAGS: a type facet, a person's edits, and tag renames
-- =====================================================================
-- Tags held two kinds of words: what an asset is about (subjects,
-- settings, organizations) and what kind of picture it is (photo,
-- diagram, chart). The kind now lives in its own column, one value from
-- a fixed list, so it filters on its own and tags stay about subjects.
--
-- A person can correct what the Media analyst wrote. edited_fields names
-- the fields a person changed; "Describe again" leaves those alone.
--
-- Renaming a tag (or merging it into another) rewrites it on every asset
-- and remembers the old name in asset_tag_aliases, so the analyst's next
-- pass that writes the old name gets the new one.
-- =====================================================================

alter table public.assets
  add column asset_type text check (asset_type in (
    'photo', 'diagram', 'chart', 'flowchart', 'map', 'screenshot', 'table',
    'logo', 'drawing', 'document scan', 'recording', 'other')),
  add column edited_fields text[] not null default '{}'
    check (edited_fields <@ array['title', 'description', 'tags', 'asset_type']::text[]);
comment on column public.assets.asset_type is 'What kind of media it is, from a fixed list; tags hold subjects only.';
comment on column public.assets.edited_fields is 'Fields a person edited; the Media analyst never overwrites them.';

-- Kind-of-picture tags already written move to asset_type (the first one wins) and leave tags
with type_words(word, asset_type) as (values
  ('photo', 'photo'), ('photos', 'photo'), ('photograph', 'photo'), ('photographs', 'photo'), ('photography', 'photo'),
  ('diagram', 'diagram'), ('diagrams', 'diagram'), ('schematic', 'diagram'),
  ('chart', 'chart'), ('charts', 'chart'), ('graph', 'chart'), ('graphs', 'chart'), ('bar chart', 'chart'), ('line chart', 'chart'), ('pie chart', 'chart'),
  ('flowchart', 'flowchart'), ('flowcharts', 'flowchart'), ('flow chart', 'flowchart'), ('flow diagram', 'flowchart'),
  ('map', 'map'), ('maps', 'map'),
  ('screenshot', 'screenshot'), ('screenshots', 'screenshot'), ('screen shot', 'screenshot'), ('screen capture', 'screenshot'),
  ('table', 'table'), ('tables', 'table'),
  ('logo', 'logo'), ('logos', 'logo'),
  ('drawing', 'drawing'), ('drawings', 'drawing'), ('illustration', 'drawing'), ('sketch', 'drawing'),
  ('document scan', 'document scan'), ('scan', 'document scan'), ('scanned document', 'document scan'),
  ('recording', 'recording'), ('recordings', 'recording'), ('video', 'recording'), ('audio', 'recording'))
update public.assets a set
  asset_type = coalesce(a.asset_type, (
    select w.asset_type from unnest(a.tags) with ordinality t(tag, ord) join type_words w on w.word = t.tag order by t.ord limit 1)),
  tags = array(select t.tag from unnest(a.tags) with ordinality t(tag, ord) where t.tag not in (select word from type_words) order by t.ord)
where exists (select 1 from unnest(a.tags) t(tag) join type_words w on w.word = t.tag);

-- OLD TAG NAMES: a renamed or merged tag's old name, pointing at the tag that replaced it
create table public.asset_tag_aliases (
  alias text primary key,
  tag text not null,
  created_at timestamptz not null default now(),
  check (alias <> tag)
);
comment on table public.asset_tag_aliases is 'Asset tags renamed or merged away: the old name and the tag it became.';
alter table public.asset_tag_aliases enable row level security;
grant select on public.asset_tag_aliases to authenticated;
grant all on public.asset_tag_aliases to service_role;
create policy asset_tag_aliases_read on public.asset_tag_aliases for select to authenticated using (true);

-- RENAMES A TAG on every asset (merging when the new name is already a tag), keeping
-- each asset's tag order and dropping the duplicate a merge makes. Returns how many assets changed.
create function public.rename_asset_tag(p_from text, p_to text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  changed int;
begin
  if p_from is null or p_to is null or p_from = '' or p_to = '' then raise exception 'Both tag names are needed'; end if;
  if p_from = p_to then return 0; end if;
  update public.assets a set tags = array(
    select x.tag from (
      select case when t.tag = p_from then p_to else t.tag end tag, min(t.ord) ord
      from unnest(a.tags) with ordinality t(tag, ord) group by 1
    ) x order by x.ord)
  where p_from = any (a.tags);
  get diagnostics changed = row_count;
  -- The new name is a tag again, not an alias; older names of the old tag follow it
  delete from public.asset_tag_aliases where alias = p_to;
  update public.asset_tag_aliases set tag = p_to where tag = p_from;
  insert into public.asset_tag_aliases (alias, tag) values (p_from, p_to)
  on conflict (alias) do update set tag = excluded.tag;
  return changed;
end $$;
revoke all on function public.rename_asset_tag(text, text) from public, anon, authenticated;
grant execute on function public.rename_asset_tag(text, text) to service_role;

notify pgrst, 'reload schema';
