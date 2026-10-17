-- Avoid OrioleDB whole-row JSON conversion of externally stored JSONB values.
-- Materialize owned values before comparing the snapshot or building the result.
create or replace function public.read_composer_run(p_page_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  run_id uuid; saved_snapshot jsonb; saved_composition jsonb; saved_review jsonb;
  saved_model text; saved_created_at timestamptz;
begin
  select r.id, (r.snapshot::text)::jsonb, (r.composition::text)::jsonb,
    (r.review::text)::jsonb, r.model::text, r.created_at
  into run_id, saved_snapshot, saved_composition, saved_review, saved_model, saved_created_at
  from public.composer_runs r where r.page_id=p_page_id and r.active;
  if run_id is null then return null; end if;
  if saved_snapshot is distinct from public.composer_page_snapshot(p_page_id) then
    return null;
  end if;
  return jsonb_build_object(
    'id',run_id,'page_id',p_page_id,'snapshot',saved_snapshot,
    'composition',saved_composition,'review',saved_review,'model',saved_model,
    'active',true,'created_at',saved_created_at
  );
end $$;
notify pgrst,'reload schema';
