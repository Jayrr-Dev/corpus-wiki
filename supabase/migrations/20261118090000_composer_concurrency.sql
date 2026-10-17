-- Keep simultaneous section requests from replacing each other's completed figures.
create function public.save_composer_run_checked(p_page_id uuid,p_snapshot jsonb,p_composition jsonb,p_review jsonb,p_model text,p_expected_run_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare current_run_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('composer:'||p_page_id::text));
  select r.id into current_run_id from composer_runs r where r.page_id=p_page_id and r.active and r.snapshot=public.composer_page_snapshot(p_page_id);
  if current_run_id is distinct from p_expected_run_id then
    raise exception 'Illustrations changed while Composer was drawing. Reload and try again.';
  end if;
  return public.save_composer_run(p_page_id,p_snapshot,p_composition,p_review,p_model);
end $$;
revoke all on function public.save_composer_run_checked(uuid,jsonb,jsonb,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.save_composer_run_checked(uuid,jsonb,jsonb,jsonb,text,uuid) to service_role;
