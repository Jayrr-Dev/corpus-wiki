-- Keep images as article attachments across complete section replacement and
-- empty intermediate states. Only selecting/removing an illustration run changes
-- its images. The original composition and reviewed snapshot remain immutable.
create or replace function public.read_composer_run(p_page_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  run_id uuid; saved_composition jsonb; saved_snapshot jsonb; saved_review jsonb;
  saved_model text; saved_created_at timestamptz; current_snapshot jsonb;
  kept jsonb := '[]'::jsonb; f jsonb; placement text; evidence jsonb;
  original_section uuid; target_section uuid; original_title text;
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
    select p->>'section' into original_title
      from jsonb_array_elements(saved_snapshot->'paragraphs') p where p->>'id'=f->>'after';
    select s.id into target_section from sections s
      where s.page_id=p_page_id and s.retired_at is null
      order by (s.id=original_section) desc,
        (lower(s.title)=lower(coalesce(original_title,''))) desc,
        (lower(s.title)='overview') desc,s.position,s.id limit 1;
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
      'sectionId',target_section,'after',coalesce(placement,f->>'after'),'evidence',evidence));
  end loop;
  return jsonb_build_object('id',run_id,'page_id',p_page_id,'snapshot',current_snapshot,
    'composition',jsonb_set(saved_composition,'{figures}',kept),'review',saved_review,
    'model',saved_model,'active',true,'created_at',saved_created_at);
end $$;
notify pgrst,'reload schema';
