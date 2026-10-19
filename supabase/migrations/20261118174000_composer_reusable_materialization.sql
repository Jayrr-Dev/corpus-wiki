-- OrioleDB cannot safely serialize the whole composer_runs row when its
-- JSONB fields live out of line. Copy fields into owned values first.
create or replace function public.read_composer_reusable_run(p_page_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  run_id uuid; saved_snapshot jsonb; saved_composition jsonb; saved_review jsonb;
  saved_model text; saved_created_at timestamptz; current_snapshot jsonb; kept jsonb;
begin
  select r.id,(r.snapshot::text)::jsonb,(r.composition::text)::jsonb,
    (r.review::text)::jsonb,r.model::text,r.created_at
  into run_id,saved_snapshot,saved_composition,saved_review,saved_model,saved_created_at
  from public.composer_runs r where r.page_id=p_page_id and r.active;
  if run_id is null then return null; end if;
  current_snapshot:=public.composer_page_snapshot(p_page_id);
  select coalesce(jsonb_agg(f order by n),'[]'::jsonb) into kept
  from jsonb_array_elements(saved_composition->'figures') with ordinality figures(f,n)
  where not exists(select 1 from jsonb_array_elements_text(f->'evidence') e where not exists(
    select 1 from jsonb_array_elements(saved_snapshot->'paragraphs') old
    join jsonb_array_elements(current_snapshot->'paragraphs') cur on cur->>'id'=old->>'id'
    where old->>'id'=e and old->>'revisionId'=cur->>'revisionId' and old->>'text'=cur->>'text'
  )) and exists(select 1 from jsonb_array_elements(current_snapshot->'paragraphs') cur where cur->>'id'=f->>'after')
  and not exists(select 1 from jsonb_array_elements(current_snapshot->'paragraphs') cur
    where (cur->>'hasMedia')::boolean and cur->>'section'=(
      select p->>'section' from jsonb_array_elements(current_snapshot->'paragraphs') p where p->>'id'=f->>'after')
    and not exists(select 1 from jsonb_array_elements(saved_snapshot->'paragraphs') old
      where old->>'id'=cur->>'id' and (old->>'hasMedia')::boolean));
  return jsonb_build_object('id',run_id,'page_id',p_page_id,'snapshot',saved_snapshot,
    'composition',jsonb_set(saved_composition,'{figures}',kept),'review',saved_review,
    'model',saved_model,'active',true,'created_at',saved_created_at);
end $$;
notify pgrst,'reload schema';
