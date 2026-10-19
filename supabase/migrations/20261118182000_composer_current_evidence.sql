-- Derive current visibility without modifying saved compositions or history.
create or replace function public.read_composer_run(p_page_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  run_id uuid; saved_composition jsonb; saved_snapshot jsonb; saved_review jsonb;
  saved_model text; saved_created_at timestamptz; current_snapshot jsonb;
  kept jsonb := '[]'::jsonb; f jsonb; ordinal bigint; target_section uuid;
  target_title text; target_position integer;
begin
  select r.id,(r.composition::text)::jsonb,(r.snapshot::text)::jsonb,
    (r.review::text)::jsonb,r.model::text,r.created_at
  into run_id,saved_composition,saved_snapshot,saved_review,saved_model,saved_created_at
  from composer_runs r where r.page_id=p_page_id and r.active;
  if run_id is null then return null; end if;
  current_snapshot:=composer_page_snapshot(p_page_id);
  if current_snapshot is null then return null; end if;
  for f,ordinal in select value,n from jsonb_array_elements(saved_composition->'figures') with ordinality e(value,n) loop
    if jsonb_typeof(f->'evidence') is distinct from 'array' or jsonb_array_length(f->'evidence')=0 then continue; end if;
    -- Every cited paragraph AND the placement must still be exactly the reviewed
    -- revision. A section title or a nearby paragraph is not proof of support.
    if exists (
      select 1 from (select jsonb_array_elements_text(f->'evidence') ref union select f->>'after') required
      where not exists (
        select 1 from jsonb_array_elements(saved_snapshot->'paragraphs') old
        join jsonb_array_elements(current_snapshot->'paragraphs') cur on cur->>'id'=old->>'id'
        join line_revisions lr on lr.id::text=cur->>'revisionId'
        where old->>'id'=required.ref and old->>'revisionId'=cur->>'revisionId' and old->>'text'=cur->>'text'
          and not exists(select 1 from unnest(lr.unit_revision_ids) cited
            left join revisions r on r.id=cited left join units u on u.id=r.unit_id
            where u.id is null or u.retired_at is not null or u.current_revision_id is distinct from cited)
      )
    ) then continue; end if;
    select s.id,s.title,s.position into target_section,target_title,target_position
      from lines l join sections s on s.id=l.section_id
      where l.id::text=f->>'after' and l.retired_at is null and s.retired_at is null and s.page_id=p_page_id;
    if target_section is null then continue; end if;
    kept:=kept||jsonb_build_array(f||jsonb_build_object('sourceIndex',ordinal-1,
      'sectionId',target_section,'sectionTitle',target_title,'sectionPosition',target_position));
  end loop;
  return jsonb_build_object('id',run_id,'page_id',p_page_id,'snapshot',current_snapshot,
    'composition',jsonb_set(saved_composition,'{figures}',kept),'review',saved_review,
    'omittedFigureCount',jsonb_array_length(saved_composition->'figures')-jsonb_array_length(kept),
    'model',saved_model,'active',true,'created_at',saved_created_at);
end $$;
-- Reuse and display must follow the same evidence checks.
create or replace function public.read_composer_reusable_run(p_page_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select public.read_composer_run(p_page_id);
$$;
notify pgrst,'reload schema';
