-- Keep original section identity independently of the current paragraph anchor.
-- A removed section's heading remains available for its images; never fall back
-- to the introduction simply because the writer removed or renamed a section.
create function public.composer_heading_similarity(p_left text,p_right text) returns double precision
language sql immutable set search_path=public as $$
  with words as (
    select distinct word,side from (values (lower(p_left),1),(lower(p_right),2)) v(title,side)
    cross join lateral regexp_split_to_table(coalesce(title,''),'[^[:alnum:]]+') word
    where length(word)>1 and word not in ('and','the','to','of','for','with','between')
  ), grouped as (select word,count(*) n from words group by word)
  select coalesce(count(*) filter (where n=2)::double precision/nullif(count(*),0),0) from grouped;
$$;
create or replace function public.read_composer_run(p_page_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  run_id uuid; saved_composition jsonb; saved_snapshot jsonb; saved_review jsonb;
  saved_model text; saved_created_at timestamptz; current_snapshot jsonb;
  kept jsonb := '[]'::jsonb; f jsonb; placement text; evidence jsonb;
  original_section uuid; target_section uuid; original_title text;
  original_position integer; target_title text; target_position integer;
begin
  select r.id,(r.composition::text)::jsonb,(r.snapshot::text)::jsonb,
    (r.review::text)::jsonb,r.model::text,r.created_at
  into run_id,saved_composition,saved_snapshot,saved_review,saved_model,saved_created_at
  from composer_runs r where r.page_id=p_page_id and r.active;
  if run_id is null then return null; end if;
  current_snapshot:=composer_page_snapshot(p_page_id);
  if current_snapshot is null then return null; end if;
  for f in select value from jsonb_array_elements(saved_composition->'figures') loop
    original_section:=null; target_section:=null; placement:=null;
    select l.section_id into original_section from lines l where l.id::text=f->>'after';
    original_section:=coalesce((f->>'originalSectionId')::uuid,original_section);
    select s.title,s.position into original_title,original_position from sections s
      where s.id=original_section and s.page_id=p_page_id;
    original_title:=coalesce(f->>'originalSectionTitle',original_title,
      (select p->>'section' from jsonb_array_elements(saved_snapshot->'paragraphs') p where p->>'id'=f->>'after'));
    original_position:=coalesce((f->>'originalSectionPosition')::integer,original_position,0);
    select s.id into target_section from sections s
      where s.page_id=p_page_id and s.retired_at is null and
        (s.id=original_section or composer_heading_similarity(s.title,original_title)>=0.65)
      order by (s.id=original_section) desc,
        (lower(s.title)=lower(coalesce(original_title,''))) desc,
        composer_heading_similarity(s.title,original_title) desc,s.position,s.id limit 1;
    target_section:=coalesce(target_section,original_section);
    select s.title,s.position into target_title,target_position from sections s where s.id=target_section;
    select p->>'id' into placement
      from jsonb_array_elements(current_snapshot->'paragraphs') with ordinality paragraphs(p,n)
      join lines l on l.id::text=p->>'id' and l.section_id=target_section
      order by (p->>'id'=f->>'after') desc,n limit 1;
    select coalesce(jsonb_agg(distinct mapped),'[]'::jsonb) into evidence
      from (select composer_current_line(value,current_snapshot) mapped
        from jsonb_array_elements_text(f->'evidence')) refs where mapped is not null;
    if jsonb_array_length(evidence)=0 and placement is not null then
      evidence:=jsonb_build_array(placement);
    end if;
    kept:=kept||jsonb_build_array(f||jsonb_build_object(
      'originalSectionId',original_section,'originalSectionTitle',original_title,
      'originalSectionPosition',original_position,'sectionId',target_section,
      'sectionTitle',coalesce(target_title,original_title),
      'sectionPosition',coalesce(target_position,original_position),
      'after',coalesce(placement,f->>'after'),'evidence',evidence));
  end loop;
  return jsonb_build_object('id',run_id,'page_id',p_page_id,'snapshot',current_snapshot,
    'composition',jsonb_set(saved_composition,'{figures}',kept),'review',saved_review,
    'model',saved_model,'active',true,'created_at',saved_created_at);
end $$;
create function public.composer_section_has_images(p_section_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from sections s
    cross join lateral jsonb_array_elements(public.read_composer_run(s.page_id)->'composition'->'figures') f
    where s.id=p_section_id and f->>'sectionId'=s.id::text);
$$;
revoke all on function public.composer_heading_similarity(text,text) from public,anon,authenticated;
grant execute on function public.composer_heading_similarity(text,text) to service_role;
revoke all on function public.composer_section_has_images(uuid) from public,anon,authenticated;
grant execute on function public.composer_section_has_images(uuid) to service_role;
notify pgrst,'reload schema';
