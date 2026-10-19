-- Illustrations are attachments, not a cache of an exact article revision.
-- Project their placements onto the current lines without changing the saved
-- drawing, caption, review or historical snapshot. Removed sections stay removed.
create function public.composer_current_line(p_line_id text, p_snapshot jsonb) returns text
language sql stable security definer set search_path=public as $$
  select p->>'id'
  from jsonb_array_elements(p_snapshot->'paragraphs') with ordinality current_lines(p,n)
  join lines current_line on current_line.id::text=p->>'id'
  join lines original_line on original_line.id::text=p_line_id
    and original_line.section_id=current_line.section_id
  order by (p->>'id'=p_line_id) desc,n
  limit 1;
$$;

create or replace function public.read_composer_run(p_page_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  run_id uuid; saved_composition jsonb; saved_review jsonb;
  saved_model text; saved_created_at timestamptz; current_snapshot jsonb;
  kept jsonb := '[]'::jsonb; f jsonb; placement text; evidence jsonb;
begin
  -- Materialize JSONB fields independently for OrioleDB.
  select r.id,(r.composition::text)::jsonb,(r.review::text)::jsonb,r.model::text,r.created_at
  into run_id,saved_composition,saved_review,saved_model,saved_created_at
  from composer_runs r where r.page_id=p_page_id and r.active;
  if run_id is null then return null; end if;
  current_snapshot:=composer_page_snapshot(p_page_id);
  if current_snapshot is null then return null; end if;
  for f in select value from jsonb_array_elements(saved_composition->'figures') loop
    placement:=composer_current_line(f->>'after',current_snapshot);
    if placement is null then continue; end if;
    select coalesce(jsonb_agg(distinct mapped),'[]'::jsonb) into evidence
    from (select composer_current_line(value,current_snapshot) mapped
      from jsonb_array_elements_text(f->'evidence')) refs where mapped is not null;
    if jsonb_array_length(evidence)=0 then evidence:=jsonb_build_array(placement); end if;
    kept:=kept||jsonb_build_array(f||jsonb_build_object('after',placement,'evidence',evidence));
  end loop;
  return jsonb_build_object('id',run_id,'page_id',p_page_id,'snapshot',current_snapshot,
    'composition',jsonb_set(saved_composition,'{figures}',kept),'review',saved_review,
    'model',saved_model,'active',true,'created_at',saved_created_at);
end $$;

-- Use the same visible version for optimistic concurrency as the reader.
-- save_composer_run still rejects a snapshot changed during drawing.
create or replace function public.save_composer_run_checked(p_page_id uuid,p_snapshot jsonb,p_composition jsonb,p_review jsonb,p_model text,p_expected_run_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare current_run_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('composer:'||p_page_id::text));
  current_run_id:=(read_composer_run(p_page_id)->>'id')::uuid;
  if current_run_id is distinct from p_expected_run_id then
    raise exception 'Illustrations changed while Composer was drawing. Reload and try again.';
  end if;
  return save_composer_run(p_page_id,p_snapshot,p_composition,p_review,p_model);
end $$;
revoke all on function public.composer_current_line(text,jsonb) from public,anon,authenticated;
grant execute on function public.composer_current_line(text,jsonb) to service_role;
notify pgrst,'reload schema';
